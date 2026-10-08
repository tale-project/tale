import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { splitSiteUrlList } from '@tale/shared/utils/site-urls';
import { z } from 'zod';

import { externalDepError } from '../../utils/fail';
import { BACKUP_VOLUME, GATEWAY_VOLUME } from '../backup/constants';
import { validateAdditionalSiteUrls } from '../config/ensure-env';
import { runtimeCommand, runtimeSleep } from './runtime-command';
import {
  activateConfiguration,
  spawnerBootSchema,
  type RuntimeConfigurationEffect,
} from './runtime-configuration';
import {
  parseRuntimeEnvironment,
  prepareRuntimeEnvironment,
} from './runtime-env';
import {
  atomicRuntimeFile,
  hash,
  isManagedOrigin,
  readRegular,
  readRuntimeBundle,
  requireRuntime,
  revisionSchema,
  RUNTIME_SERVICES,
  runtimeImageSchema,
  TALE_REGISTRY,
  type ApplyRuntimeOptions,
  type ComposeDocument,
  type RuntimeBundle,
  type RuntimeDependencies,
  type RuntimeResult,
} from './runtime-model';
import { inspectRuntimeImage } from './runtime-prepare';

const sha = z.string().regex(/^[a-f0-9]{64}$/);
const installedFiles = [
  'compose.yml',
  'Caddyfile.production',
  '.env',
  'secrets.env',
] as const;
const fileHashes = z
  .object({
    'compose.yml': sha,
    'Caddyfile.production': sha,
    '.env': sha,
    'secrets.env': sha,
  })
  .strict();
const nullableHashes = z
  .object({
    'compose.yml': sha.nullable(),
    'Caddyfile.production': sha.nullable(),
    '.env': sha.nullable(),
    'secrets.env': sha.nullable(),
  })
  .strict();
const receiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    phase: z.enum(['pending', 'ready']),
    name: z.string(),
    stateDirectory: z.string(),
    composeProject: z.string(),
    revision: revisionSchema,
    bundleSha256: sha,
    inputSha256: sha,
    stage: z.string().uuid(),
    existing: z.boolean(),
    before: nullableHashes,
    files: fileHashes,
    regeneratedSecrets: z.array(z.string()),
    images: z.array(runtimeImageSchema),
  })
  .strict();
type RuntimeReceipt = z.infer<typeof receiptSchema>;

const containerSchema = z.object({
  Id: z.string().regex(/^[a-f0-9]{12,64}$/),
  Name: z.string(),
  Config: z.object({
    Image: z.string(),
    Labels: z.record(z.string(), z.string()).nullable(),
  }),
  State: z.object({
    Running: z.boolean(),
    StartedAt: z.string().optional(),
    Health: z.object({ Status: z.string() }).optional(),
  }),
  Mounts: z.array(
    z.object({
      Type: z.string(),
      Name: z.string().optional(),
      Source: z.string(),
      Destination: z.string(),
      RW: z.boolean().optional(),
    }),
  ),
});
type RuntimeContainer = z.infer<typeof containerSchema>;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw externalDepError('Docker returned invalid runtime metadata.');
  }
}
function currentHash(file: string): string | null {
  return existsSync(file) ? hash(readRegular(file)) : null;
}
function targetPath(options: ApplyRuntimeOptions, file: string): string {
  return join(
    options.stateDirectory,
    file === 'secrets.env' ? file : `src/${file}`,
  );
}
/** Whether a runtime environment serves exactly the declared additional
 * origins. The list is managed, so any other value — or one left behind
 * without a declaration — is drift; order and repetition carry no meaning. */
function sameAdditionalOrigins(
  environment: Record<string, string>,
  declared: readonly string[] | undefined,
): boolean {
  const serving = new Set(splitSiteUrlList(environment.ADDITIONAL_SITE_URLS));
  const wanted = new Set(declared);
  return (
    serving.size === wanted.size &&
    [...wanted].every((origin) => serving.has(origin))
  );
}
function receiptInput(options: ApplyRuntimeOptions): string {
  return hash(
    JSON.stringify({
      stateDirectory: options.stateDirectory,
      composeProject: options.composeProject,
      name: options.name,
      origin: options.origin,
      // Present only when declared, so every receipt recorded without
      // additional origins keeps its exact input hash.
      ...(options.additionalOrigins?.length
        ? { additionalOrigins: options.additionalOrigins }
        : {}),
      ...(options.organizationCreators?.length
        ? { organizationCreators: options.organizationCreators }
        : {}),
      tlsMode: options.tlsMode,
      tlsEmail: options.tlsEmail ?? '',
      environment: Object.entries(options.environment ?? {}).sort(([a], [b]) =>
        a.localeCompare(b),
      ),
    }),
  );
}
function readReceipt(file: string): RuntimeReceipt | null {
  if (!existsSync(file)) return null;
  const parsed = receiptSchema.safeParse(
    parseJson(readRegular(file).toString('utf8')),
  );
  requireRuntime(
    parsed.success,
    'Managed runtime receipt is malformed; review the existing state.',
  );
  return parsed.data;
}

function pendingBytes(
  options: ApplyRuntimeOptions,
  receipt: RuntimeReceipt,
): Record<string, Buffer> {
  const directory = join(
    options.stateDirectory,
    '.tale',
    `runtime-${receipt.stage}`,
  );
  const status = lstatSync(directory);
  requireRuntime(
    status.isDirectory() && !status.isSymbolicLink(),
    'Pending runtime directory is not a private regular directory.',
  );
  const files = Object.fromEntries(
    installedFiles.map((file) => [file, readRegular(join(directory, file))]),
  );
  for (const file of installedFiles)
    requireRuntime(
      hash(files[file]) === receipt.files[file],
      'Pending runtime bytes differ; no activation is permitted.',
    );
  return files;
}

function validateOptions(options: ApplyRuntimeOptions): void {
  requireRuntime(
    isAbsolute(options.stateDirectory) &&
      resolve(options.stateDirectory) === options.stateDirectory &&
      options.stateDirectory !== '/' &&
      !/[\x00-\x1f,]/.test(options.stateDirectory),
    'Managed runtime requires an explicit absolute state directory.',
  );
  requireRuntime(
    /^[a-z0-9][a-z0-9_-]{0,62}$/.test(options.composeProject) &&
      /^[a-z0-9][a-z0-9-]{0,62}$/.test(options.name),
    'Invalid runtime instance or Compose project.',
  );
  requireRuntime(
    URL.canParse(options.origin),
    'Invalid managed runtime origin.',
  );
  requireRuntime(
    isManagedOrigin(options.origin),
    'Managed production runtime requires a canonical HTTPS origin.',
  );
  const additionalOrigins = options.additionalOrigins;
  requireRuntime(
    additionalOrigins === undefined ||
      (additionalOrigins.length > 0 &&
        additionalOrigins.length <= 16 &&
        new Set(additionalOrigins).size === additionalOrigins.length &&
        additionalOrigins.every(
          (entry) => entry !== options.origin && isManagedOrigin(entry),
        ) &&
        validateAdditionalSiteUrls({
          additionalSiteUrls: additionalOrigins.join(','),
          tlsMode: options.tlsMode,
        }).length === 0),
    'Managed runtime additional origins must be distinct canonical HTTPS origins its TLS mode can serve.',
  );
  const organizationCreators = options.organizationCreators;
  requireRuntime(
    organizationCreators === undefined ||
      (organizationCreators.length > 0 &&
        organizationCreators.length <= 64 &&
        new Set(organizationCreators.map((entry) => entry.toLowerCase()))
          .size === organizationCreators.length &&
        organizationCreators.every(
          (entry) => entry.length <= 254 && /^[^\s,;@]+@[^\s,;@]+$/.test(entry),
        )),
    'Managed runtime organization creators must be distinct e-mail addresses.',
  );
  requireRuntime(
    options.tlsMode === 'external' || options.tlsMode === 'letsencrypt',
    'Unsupported managed runtime TLS mode.',
  );
  requireRuntime(
    options.tlsEmail === undefined ||
      /^[^\s"'<>|{}]+@[^\s"'<>|{}]+$/.test(options.tlsEmail),
    'Invalid runtime TLS contact.',
  );
  for (const directory of [
    options.stateDirectory,
    join(options.stateDirectory, 'src'),
    join(options.stateDirectory, '.tale'),
  ]) {
    if (!existsSync(directory)) continue;
    const status = lstatSync(directory);
    requireRuntime(
      status.isDirectory() && !status.isSymbolicLink(),
      'Managed runtime directory must not be a symlink or file.',
    );
  }
}

async function runtimeContainers(
  project: string,
  dependencies: RuntimeDependencies,
): Promise<RuntimeContainer[]> {
  const listed = await runtimeCommand(
    [
      'ps',
      '-a',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--format',
      '{{.ID}}',
    ],
    dependencies,
  );
  const ids = listed.stdout
    .split('\n')
    .map((id) => id.trim())
    .filter(Boolean);
  requireRuntime(
    ids.every((id) => /^[a-f0-9]{12,64}$/.test(id)),
    'Docker returned invalid container identifiers.',
  );
  if (!ids.length) return [];
  const result = await runtimeCommand(
    ['container', 'inspect', ...ids],
    dependencies,
  );
  const parsed = z.array(containerSchema).safeParse(parseJson(result.stdout));
  requireRuntime(
    parsed.success && parsed.data.length === ids.length,
    'Docker container metadata is incomplete.',
  );
  return parsed.data;
}

async function assertFixedContainerNames(
  containers: RuntimeContainer[],
  compose: ComposeDocument,
  dependencies: RuntimeDependencies,
): Promise<void> {
  const names = new Set(
    Object.values(compose.services).flatMap((service) => {
      if (service.container_name === undefined) return [];
      requireRuntime(
        typeof service.container_name === 'string' &&
          /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(service.container_name),
        'Runtime contains an invalid fixed container name.',
      );
      return [service.container_name];
    }),
  );
  if (!names.size) return;
  const listed = await runtimeCommand(
    ['ps', '-a', '--format', '{{.ID}}\t{{.Names}}'],
    dependencies,
  );
  const ownedIds = new Set(containers.map((container) => container.Id));
  for (const line of listed.stdout.split('\n').filter(Boolean)) {
    const [id, name] = line.split('\t');
    requireRuntime(
      id && name,
      'Docker returned invalid fixed-container metadata.',
    );
    if (names.has(name))
      requireRuntime(
        [...ownedIds].some((owned) => owned === id || owned.startsWith(id)),
        'A fixed Tale container name belongs to another deployment.',
      );
  }
}

function assertContainerCustody(
  containers: RuntimeContainer[],
  compose: ComposeDocument,
  options: ApplyRuntimeOptions,
  projectVolumes?: ReadonlySet<string>,
): void {
  const seen = new Set<string>();
  for (const container of containers) {
    const labels = container.Config.Labels;
    const service = labels?.['com.docker.compose.service'];
    requireRuntime(
      labels?.['com.docker.compose.project'] === options.composeProject &&
        labels['com.docker.compose.project.working_dir'] ===
          join(options.stateDirectory, 'src') &&
        labels['com.docker.compose.container-number'] === '1' &&
        labels['com.docker.compose.oneoff']?.toLowerCase() !== 'true' &&
        service &&
        RUNTIME_SERVICES.includes(
          service as (typeof RUNTIME_SERVICES)[number],
        ) &&
        !seen.has(service),
      'Existing containers do not match this managed runtime identity and topology.',
    );
    seen.add(service);
    const desired = z
      .array(z.string())
      .parse(compose.services[service].volumes ?? []);
    const expected = desired.map((volume) => {
      const [source, target, mode] = volume.split(':');
      requireRuntime(
        source && target,
        'Unsupported runtime mount declaration.',
      );
      const named = Object.hasOwn(compose.volumes, source);
      requireRuntime(
        named ||
          [
            '/var/run/docker.sock',
            '/var/lib/tale-sandbox',
            './Caddyfile.production',
          ].includes(source),
        'Runtime contains an unsupported host mount.',
      );
      return {
        named,
        source: named
          ? projectVolumeName(options.composeProject, source)
          : source.startsWith('./')
            ? join(options.stateDirectory, 'src', source.slice(2))
            : source,
        target,
        readonly: mode === 'ro',
      };
    });
    const matched = new Set<number>();
    for (const actual of container.Mounts) {
      const index = expected.findIndex(
        (mount, candidate) =>
          !matched.has(candidate) &&
          actual.Destination === mount.target &&
          actual.Type === (mount.named ? 'volume' : 'bind') &&
          (mount.named ? actual.Name : actual.Source) === mount.source &&
          actual.RW === !mount.readonly,
      );
      requireRuntime(
        index >= 0,
        'Existing runtime data-volume or host-mount identity differs.',
      );
      matched.add(index);
    }
    const missing = expected.filter((_, index) => !matched.has(index));
    if (missing.length > 0) {
      // A release may add a new named volume to a retained 0.5 runtime. The
      // volume has no data yet, and Compose will recreate only the affected
      // service during the normal `up`; every existing mount remains checked
      // above. A missing bind mount, or a named volume that already exists,
      // still means the retained container has drifted and is refused.
      const additive =
        projectVolumes !== undefined &&
        missing.every(
          (mount) => mount.named && !projectVolumes.has(mount.source),
        );
      requireRuntime(
        additive,
        'Existing runtime mounts differ from the managed topology.',
      );
    }
  }
}

async function inspectSandboxNetwork(
  dependencies: RuntimeDependencies,
): Promise<boolean> {
  const inspected = await runtimeCommand(
    ['network', 'inspect', 'tale-sandbox-net'],
    dependencies,
    { allowFailure: true },
  );
  if (!inspected.success) {
    requireRuntime(
      /no such network|not found/i.test(inspected.stderr),
      'Sandbox network inspection failed.',
    );
    return false;
  }
  const parsed = z
    .array(
      z.object({
        Driver: z.string(),
        Internal: z.boolean(),
        EnableIPv6: z.boolean(),
      }),
    )
    .length(1)
    .safeParse(parseJson(inspected.stdout));
  requireRuntime(
    parsed.success &&
      parsed.data[0].Driver === 'bridge' &&
      parsed.data[0].Internal &&
      !parsed.data[0].EnableIPv6,
    'Existing sandbox network must be an internal bridge with IPv6 disabled.',
  );
  return true;
}

/** Whether the service's declaration makes Docker keep health evidence. */
function healthRequired(
  container: RuntimeContainer,
  compose: ComposeDocument,
): boolean {
  const service = container.Config.Labels?.['com.docker.compose.service'];
  const check = service && compose.services[service]?.healthcheck;
  const disabled =
    typeof check === 'object' &&
    check !== null &&
    (('disable' in check && check.disable === true) ||
      ('test' in check &&
        Array.isArray(check.test) &&
        check.test.length === 1 &&
        check.test[0] === 'NONE'));
  return check !== undefined && !disabled;
}

function reportsHealthy(
  container: RuntimeContainer,
  compose: ComposeDocument,
): boolean {
  return (
    (!healthRequired(container, compose) &&
      container.State.Health === undefined) ||
    container.State.Health?.Status === 'healthy'
  );
}

/**
 * Whether every managed service runs as its declared container and image,
 * with the health evidence its declaration requires: the state `compose up`
 * converges to. The health STATUS is deliberately not part of it. Compose
 * never recreates a running container for its health; it only refuses to
 * start the dependants of one that reads unhealthy, which a snapshot's pause
 * leaves behind until the next probe. That is waited out, not handed to
 * Compose.
 */
function converged(
  containers: RuntimeContainer[],
  bundle: RuntimeBundle,
  compose: ComposeDocument,
): boolean {
  return (
    containers.length === RUNTIME_SERVICES.length &&
    containers.every((container) => {
      const service = container.Config.Labels?.['com.docker.compose.service'];
      const expectedName = service && compose.services[service]?.container_name;
      return (
        container.State.Running &&
        (expectedName === undefined || container.Name === `/${expectedName}`) &&
        (!healthRequired(container, compose) ||
          container.State.Health !== undefined) &&
        bundle.images.some(
          (image) =>
            image.services.includes(
              service as (typeof RUNTIME_SERVICES)[number],
            ) && image.reference === container.Config.Image,
        )
      );
    })
  );
}

/**
 * Moby writes `State.StartedAt` in Go's RFC3339Nano (daemon/inspect.go): a
 * calendar date and time with seconds, at most nine fraction digits and a
 * zone, and the zero time, year 1, for a container that never started. Zod
 * checks the calendar, the ranges and the offset; the pattern adds the
 * seconds, which Zod leaves optional, and the fraction's bound.
 */
export const startedAtSchema = z.iso
  .datetime({ offset: true })
  .regex(/T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/);

/** A running container has started; a stopped one only by a start time in
 * Moby's contract after the Unix epoch, so an empty, malformed or zero time is
 * no evidence that its image ever ran. */
function hasStarted(container: RuntimeContainer): boolean {
  if (container.State.Running) return true;
  const startedAt = startedAtSchema.safeParse(container.State.StartedAt);
  if (!startedAt.success) return false;
  // Date.parse keeps milliseconds only. The whole second is exact, and the
  // fraction decides alone for a start within the epoch's own second.
  const second = Date.parse(startedAt.data.replace(/\.\d+/, ''));
  const fraction = /\.(\d+)/.exec(startedAt.data)?.[1] ?? '';
  return second > 0 || (second === 0 && /[1-9]/.test(fraction));
}

/** One record of `docker volume ls --format '{{json .}}'`. Its name is opaque:
 * Moby leaves the rule to each volume driver, and a plugin may choose any. */
const volumeRecordSchema = z.object({ Name: z.string().min(1) });

/**
 * The names of the volumes Docker listed, read only once every line is a
 * record with a name. A listing that is not a list of records is not an
 * inventory: filtered as one, it would read every volume, the gateway store's
 * included, as absent. An empty listing is a host without volumes.
 */
function projectVolumeName(project: string, source: string): string {
  return `${project}_${source}`;
}

function volumeInventory(stdout: string): string[] {
  const records = (stdout === '' ? [] : stdout.split('\n')).map((line) =>
    parseJson(line),
  );
  const parsed = z.array(volumeRecordSchema).safeParse(records);
  requireRuntime(parsed.success, 'Docker volume metadata is incomplete.');
  return parsed.data.map((record) => record.Name);
}

/**
 * The model gateway's store as the runtime finds it, before anything changes.
 * The store has run the target image when a ready runtime receipt lists it or
 * a gateway container on it has started; only a start on an image the store
 * has not run can migrate it. `inspectedDigests` holds the digests an
 * adoption read for tag-referenced containers.
 */
function gatewayState(
  receipt: RuntimeReceipt | null,
  containers: RuntimeContainer[],
  bundle: RuntimeBundle,
  volume: boolean,
  inspectedDigests: ReadonlyMap<string, string>,
): RuntimeResult['gateway'] {
  const target = bundle.images.find((image) =>
    image.services.includes('sandbox-llm-gateway'),
  );
  const container = containers.find(
    (candidate) =>
      candidate.Config.Labels?.['com.docker.compose.service'] ===
      'sandbox-llm-gateway',
  );
  const ranTarget =
    target !== undefined &&
    ((receipt?.phase === 'ready' &&
      receipt.images.some(
        (image) =>
          image.services.includes('sandbox-llm-gateway') &&
          image.digest === target.digest,
      )) ||
      (container !== undefined &&
        hasStarted(container) &&
        (container.Config.Image === target.reference ||
          inspectedDigests.get(container.Config.Image) === target.digest)));
  return {
    volume,
    newImage: !ranTarget,
    target: target?.reference ?? null,
    running: container?.State.Running ? container.Config.Image : null,
  };
}

function healthy(
  containers: RuntimeContainer[],
  bundle: RuntimeBundle,
  compose: ComposeDocument,
): boolean {
  return (
    converged(containers, bundle, compose) &&
    containers.every((container) => reportsHealthy(container, compose))
  );
}

const REPORTED_HEALTH = ['starting', 'unhealthy'] as const;

/**
 * The managed services that are not running healthy, for a failure summary:
 * `proxy: unhealthy`, `db: not running`. Fixed vocabulary only — the service
 * comes from the managed topology and the health from Docker's enum, so
 * nothing a container or Compose printed can reach the message.
 */
function unsettledServices(
  containers: RuntimeContainer[],
  compose: ComposeDocument,
): string | null {
  const unsettled = RUNTIME_SERVICES.flatMap((service) => {
    const container = containers.find(
      (candidate) =>
        candidate.Config.Labels?.['com.docker.compose.service'] === service,
    );
    if (!container) return [];
    if (!container.State.Running) return [`${service}: not running`];
    if (reportsHealthy(container, compose)) return [];
    const health = REPORTED_HEALTH.find(
      (status) => status === container.State.Health?.Status,
    );
    return [`${service}: ${health ?? 'no health status'}`];
  });
  return unsettled.length > 0 ? unsettled.join(', ') : null;
}

async function waitForRuntime(
  options: ApplyRuntimeOptions,
  bundle: RuntimeBundle,
  compose: ComposeDocument,
  dependencies: RuntimeDependencies,
): Promise<RuntimeContainer[]> {
  let containers: RuntimeContainer[] = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    containers = await runtimeContainers(options.composeProject, dependencies);
    assertContainerCustody(containers, compose, options);
    if (healthy(containers, bundle, compose)) {
      const sandbox = containers.find(
        (container) =>
          container.Config.Labels?.['com.docker.compose.service'] === 'sandbox',
      );
      requireRuntime(sandbox, 'Runtime has no sandbox spawner.');
      const health = await runtimeCommand(
        [
          'exec',
          sandbox.Id,
          'curl',
          '-fsS',
          '--connect-timeout',
          '2',
          '--max-time',
          '5',
          'http://127.0.0.1:8003/health',
        ],
        dependencies,
        { allowFailure: true, timeout: 10 },
      );
      if (health.success) return containers;
    }
    if (attempt !== 59) await runtimeSleep(dependencies, 3000);
  }
  const unsettled = unsettledServices(containers, compose);
  throw externalDepError(
    `Managed runtime did not become healthy${unsettled ? ` (${unsettled})` : ''}; pending state is retained for recovery.`,
  );
}

/** Caller holds the deployment lock and snapshots a changed existing runtime. */
export async function applyRuntime(
  options: ApplyRuntimeOptions,
  dependencies: RuntimeDependencies = {},
): Promise<RuntimeResult> {
  validateOptions(options);
  const { bundle, identity, compose, contents } = readRuntimeBundle(
    options.bundleDirectory,
  );
  const destination = await runtimeCommand(
    ['info', '--format', '{{.OSType}}/{{.Architecture}}'],
    dependencies,
  );
  const destinationPlatform = destination.stdout
    .trim()
    .replace(/\/x86_64$/, '/amd64')
    .replace(/\/aarch64$/, '/arm64');
  requireRuntime(
    destinationPlatform === bundle.platform,
    'Docker destination platform differs from the prepared runtime.',
  );
  const sourceDirectory = join(options.stateDirectory, 'src');
  const receiptPath = join(options.stateDirectory, '.tale', 'runtime.json');
  let receipt = readReceipt(receiptPath);
  if (receipt)
    requireRuntime(
      receipt.name === options.name &&
        receipt.stateDirectory === options.stateDirectory &&
        receipt.composeProject === options.composeProject,
      'Existing runtime receipt belongs to another instance.',
    );
  const inputSha256 = receiptInput(options);
  if (receipt?.phase === 'pending')
    requireRuntime(
      receipt.bundleSha256 === identity && receipt.inputSha256 === inputSha256,
      'A different runtime operation is pending; recover that exact operation first.',
    );
  if (receipt?.phase === 'pending') pendingBytes(options, receipt);
  const networkExists = await inspectSandboxNetwork(dependencies);
  const volumeResult = await runtimeCommand(
    ['volume', 'ls', '--format', '{{json .}}'],
    dependencies,
  );
  const projectVolumes = volumeInventory(volumeResult.stdout).filter((name) =>
    name.startsWith(projectVolumeName(options.composeProject, '')),
  );
  const projectVolumeSet = new Set(projectVolumes);
  let containers = await runtimeContainers(
    options.composeProject,
    dependencies,
  );
  assertContainerCustody(
    containers,
    compose,
    options,
    receipt?.phase === 'ready' && receipt.bundleSha256 === identity
      ? undefined
      : projectVolumeSet,
  );
  await assertFixedContainerNames(containers, compose, dependencies);
  requireRuntime(
    projectVolumes.every(
      (name) =>
        name === projectVolumeName(options.composeProject, BACKUP_VOLUME) ||
        Object.hasOwn(
          compose.volumes,
          name.slice(options.composeProject.length + 1),
        ),
    ),
    'Existing Compose project contains unrecognized data volumes.',
  );
  const existing =
    containers.length > 0 ||
    existsSync(join(options.stateDirectory, 'secrets.env')) ||
    existsSync(join(sourceDirectory, '.env')) ||
    Boolean(receipt?.existing);
  const inspectedDigests = new Map<string, string>();
  if (!receipt) {
    if (existing) {
      requireRuntime(
        containers.length === RUNTIME_SERVICES.length,
        'Existing runtime is incomplete and has no managed recovery receipt.',
      );
      const environment = parseRuntimeEnvironment(
        readRegular(join(sourceDirectory, '.env')).toString('utf8'),
        'compose',
      );
      requireRuntime(
        environment.SITE_URL === options.origin &&
          environment.HOST === new URL(options.origin).hostname &&
          environment.TLS_MODE === options.tlsMode &&
          sameAdditionalOrigins(environment, options.additionalOrigins),
        'Existing runtime origin or TLS identity differs from the requested adoption.',
      );
      requireRuntime(
        /^0\.5\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(environment.VERSION ?? ''),
        'Existing runtime is not a recognized 0.5 source-Compose deployment.',
      );
      const sourceRevisions = new Set<string>();
      const inspected = new Set<string>();
      for (const container of containers) {
        const service = container.Config.Labels?.['com.docker.compose.service'];
        const expected = bundle.images.find((image) =>
          image.services.includes(service as (typeof RUNTIME_SERVICES)[number]),
        );
        requireRuntime(
          expected,
          'Existing runtime image service is unrecognized.',
        );
        if (inspected.has(container.Config.Image)) continue;
        inspected.add(container.Config.Image);
        const current = await inspectRuntimeImage(
          container.Config.Image,
          expected.repository,
          bundle.platform,
          null,
          dependencies,
        );
        inspectedDigests.set(container.Config.Image, current.digest);
        if (expected.repository.startsWith(`${TALE_REGISTRY}/`)) {
          const currentRevision = revisionSchema.safeParse(current.revision);
          requireRuntime(
            currentRevision.success,
            'Existing Tale image has no complete source revision.',
          );
          sourceRevisions.add(currentRevision.data);
        }
      }
      requireRuntime(
        sourceRevisions.size === 1,
        'Existing runtime contains mixed Tale source revisions; review the interrupted deployment.',
      );
    } else {
      requireRuntime(
        projectVolumes.length === 0,
        'Unowned existing data volumes prevent initializing this runtime.',
      );
      requireRuntime(
        !existsSync(sourceDirectory) ||
          readdirSync(sourceDirectory).length === 0,
        'Unrecognized source directory prevents initializing this runtime.',
      );
      requireRuntime(
        !existsSync(options.stateDirectory) ||
          readdirSync(options.stateDirectory).every((file) =>
            ['src', '.tale'].includes(file),
          ),
        'Unrecognized existing state prevents initializing this runtime.',
      );
    }
  }
  if (receipt) {
    for (const file of installedFiles) {
      const current = currentHash(targetPath(options, file));
      requireRuntime(
        current === receipt.files[file] ||
          (receipt.phase === 'pending' && current === receipt.before[file]),
        'Managed runtime file drift requires operator review before deployment.',
      );
    }
  }
  // Read before anything changes: the result keeps what the rollout found.
  const gateway = gatewayState(
    receipt,
    containers,
    bundle,
    projectVolumes.includes(
      projectVolumeName(options.composeProject, GATEWAY_VOLUME),
    ),
    inspectedDigests,
  );
  const environment = prepareRuntimeEnvironment(
    options,
    bundle.revision,
    existing && !(receipt?.phase === 'pending' && !receipt.existing),
    !options.dryRun,
  );
  const planned = {
    ...contents,
    '.env': Buffer.from(environment.environment),
    'secrets.env': Buffer.from(environment.secrets),
  };
  const changed =
    receipt?.phase !== 'ready' ||
    receipt.bundleSha256 !== identity ||
    receipt.inputSha256 !== inputSha256 ||
    !networkExists ||
    // A converged runtime that only reads unhealthy or starting is awaited
    // below: Compose would change nothing, only refuse its dependants.
    !converged(containers, bundle, compose) ||
    installedFiles.some(
      (file) => currentHash(targetPath(options, file)) !== hash(planned[file]),
    );
  const operationRegeneratedSecrets =
    receipt?.phase === 'pending'
      ? receipt.regeneratedSecrets
      : environment.regeneratedSecrets;
  const result = (): RuntimeResult => ({
    backendContainer:
      containers.find(
        (container) =>
          container.Config.Labels?.['com.docker.compose.service'] ===
          'backend-api',
      )?.Id ?? null,
    sourceDirectory,
    regeneratedSecrets: operationRegeneratedSecrets,
    images: bundle.images,
    revision: bundle.revision,
    changed,
    existing,
    gateway,
    dryRun: options.dryRun ?? false,
  });
  if (options.dryRun) return result();
  if (!changed) {
    // An unchanged receipt is still a claim about the running service and the
    // spawner's two local aliases, not just a comparison of JSON files.
    for (const image of bundle.images)
      for (const alias of image.localAliases) {
        const actual = await inspectRuntimeImage(
          alias,
          image.repository,
          bundle.platform,
          image.revision,
          dependencies,
        );
        requireRuntime(
          actual.digest === image.digest,
          'Runtime sandbox image alias drift requires review.',
        );
      }
    containers = await waitForRuntime(options, bundle, compose, dependencies);
    return result();
  }
  // Fetch and verify all bytes before writing instance files or starting any
  // service. A selected tag is never consulted on the remote host.
  for (const image of bundle.images) {
    await runtimeCommand(
      ['pull', '--platform', bundle.platform, image.reference],
      dependencies,
      { timeout: 1800 },
    );
    const actual = await inspectRuntimeImage(
      image.reference,
      image.repository,
      bundle.platform,
      image.revision,
      dependencies,
    );
    requireRuntime(
      actual.digest === image.digest,
      'Pulled runtime image digest differs from its bundle.',
    );
  }
  mkdirSync(join(options.stateDirectory, '.tale'), {
    recursive: true,
    mode: 0o750,
  });
  mkdirSync(sourceDirectory, { recursive: true, mode: 0o750 });
  if (receipt?.phase !== 'pending') {
    const stage = randomUUID();
    const stageDirectory = join(
      options.stateDirectory,
      '.tale',
      `runtime-${stage}`,
    );
    mkdirSync(stageDirectory, { mode: 0o700 });
    for (const file of installedFiles)
      atomicRuntimeFile(join(stageDirectory, file), planned[file]);
    receipt = receiptSchema.parse({
      schemaVersion: 1,
      phase: 'pending',
      name: options.name,
      stateDirectory: options.stateDirectory,
      composeProject: options.composeProject,
      revision: bundle.revision,
      bundleSha256: identity,
      inputSha256,
      stage,
      existing,
      before: Object.fromEntries(
        installedFiles.map((file) => [
          file,
          currentHash(targetPath(options, file)),
        ]),
      ),
      files: Object.fromEntries(
        installedFiles.map((file) => [file, hash(planned[file])]),
      ),
      regeneratedSecrets: environment.regeneratedSecrets,
      images: bundle.images,
    });
    atomicRuntimeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  const staged = pendingBytes(options, receipt);
  // Secret values live only in private env files. Pending metadata proves the
  // exact pair before the first alias/file changes, including crash recovery.
  for (const file of [
    'secrets.env',
    '.env',
    'compose.yml',
    'Caddyfile.production',
  ] as const) {
    atomicRuntimeFile(targetPath(options, file), staged[file]);
  }
  if (!networkExists) {
    await runtimeCommand(
      [
        'network',
        'create',
        '--label',
        `project=${options.composeProject}`,
        '--internal',
        '--ipv6=false',
        '--driver=bridge',
        'tale-sandbox-net',
      ],
      dependencies,
    );
    requireRuntime(
      await inspectSandboxNetwork(dependencies),
      'Sandbox network creation did not converge.',
    );
  }
  if (dependencies.ensureSandboxWorkspace)
    dependencies.ensureSandboxWorkspace();
  else mkdirSync('/var/lib/tale-sandbox', { recursive: true, mode: 0o750 });
  for (const image of bundle.images)
    for (const alias of image.localAliases) {
      await runtimeCommand(['tag', image.reference, alias], dependencies);
    }
  const composeArgs = [
    'compose',
    '-p',
    options.composeProject,
    '--project-directory',
    sourceDirectory,
    '--env-file',
    join(sourceDirectory, '.env'),
    '-f',
    join(sourceDirectory, 'compose.yml'),
  ];
  await runtimeCommand([...composeArgs, 'config', '--quiet'], dependencies, {
    cwd: sourceDirectory,
    operation: 'compose-validation',
  });
  await runtimeCommand(
    [
      ...composeArgs,
      'up',
      '-d',
      '--no-build',
      '--pull',
      'never',
      ...(receipt.regeneratedSecrets.length ? ['--force-recreate'] : []),
    ],
    dependencies,
    {
      cwd: sourceDirectory,
      timeout: 600,
      operation: 'compose-startup',
      // Compose names the dependency it refused on only in output that can
      // also carry the environment; Docker's state says the same safely.
      diagnose: async () =>
        unsettledServices(
          await runtimeContainers(options.composeProject, dependencies),
          compose,
        ),
    },
  );
  containers = await waitForRuntime(options, bundle, compose, dependencies);
  for (const file of installedFiles)
    requireRuntime(
      currentHash(targetPath(options, file)) === receipt.files[file],
      'Runtime files changed before the health receipt could be recorded.',
    );
  receipt = { ...receipt, phase: 'ready' };
  atomicRuntimeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return result();
}

/** Inspect an already-ready destination without resolving deployment secrets,
 * preparing environment files or admitting a pending rollout. Export callers
 * hold the same outer deployment lock and reuse these runtime custody checks. */
export async function observeReadyState(
  options: Omit<ApplyRuntimeOptions, 'environment' | 'dryRun'>,
  dependencies: RuntimeDependencies = {},
) {
  validateOptions(options);
  const { bundle, identity, compose } = readRuntimeBundle(
    options.bundleDirectory,
  );
  const receipt = readReceipt(
    join(options.stateDirectory, '.tale', 'runtime.json'),
  );
  requireRuntime(
    receipt?.phase === 'ready' &&
      receipt.name === options.name &&
      receipt.stateDirectory === options.stateDirectory &&
      receipt.composeProject === options.composeProject &&
      receipt.revision === bundle.revision &&
      receipt.bundleSha256 === identity &&
      JSON.stringify(receipt.images) === JSON.stringify(bundle.images),
    'Credential export requires the exact ready runtime receipt.',
  );
  for (const file of installedFiles)
    requireRuntime(
      currentHash(targetPath(options, file)) === receipt.files[file],
      'Managed runtime file drift prevents credential export.',
    );
  const environment = parseRuntimeEnvironment(
    readRegular(join(options.stateDirectory, 'src', '.env')).toString('utf8'),
    'compose',
  );
  requireRuntime(
    environment.SITE_URL === options.origin &&
      environment.HOST === new URL(options.origin).hostname &&
      environment.TLS_MODE === options.tlsMode &&
      sameAdditionalOrigins(environment, options.additionalOrigins),
    'Managed runtime origin differs from the credential export target.',
  );
  const destination = await runtimeCommand(
    ['info', '--format', '{{.OSType}}/{{.Architecture}}'],
    dependencies,
  );
  requireRuntime(
    destination.stdout
      .trim()
      .replace(/\/x86_64$/, '/amd64')
      .replace(/\/aarch64$/, '/arm64') === bundle.platform,
    'Credential export destination architecture differs.',
  );
  requireRuntime(
    await inspectSandboxNetwork(dependencies),
    'Ready runtime sandbox network is missing.',
  );
  const containers = await runtimeContainers(
    options.composeProject,
    dependencies,
  );
  assertContainerCustody(containers, compose, options);
  await assertFixedContainerNames(containers, compose, dependencies);
  requireRuntime(
    healthy(containers, bundle, compose),
    'Credential export requires the complete healthy pinned runtime.',
  );
  for (const image of bundle.images)
    for (const reference of [image.reference, ...image.localAliases]) {
      const actual = await inspectRuntimeImage(
        reference,
        image.repository,
        bundle.platform,
        image.revision,
        dependencies,
      );
      requireRuntime(
        actual.digest === image.digest,
        'Ready runtime image identity drift prevents credential export.',
      );
    }
  const backend = containers.find(
    (container) =>
      container.Config.Labels?.['com.docker.compose.service'] === 'backend-api',
  );
  requireRuntime(backend, 'Ready backend was not identified.');
  return {
    containers,
    runtime: {
      backendContainer: backend.Id,
      sourceDirectory: join(options.stateDirectory, 'src'),
      images: bundle.images,
      revision: bundle.revision,
    },
  };
}

export async function observeReadyRuntime(
  options: Omit<ApplyRuntimeOptions, 'environment' | 'dryRun'>,
  dependencies: RuntimeDependencies = {},
): Promise<
  Pick<
    RuntimeResult,
    'backendContainer' | 'sourceDirectory' | 'images' | 'revision'
  >
> {
  return (await observeReadyState(options, dependencies)).runtime;
}

/** Boot-only native settings become ready only after their exact spawner has
 * drained and restarted. Runtime adoption/recovery remains the single owner
 * of topology, files, images and health; this restarts no other service. */
export async function activateRuntimeConfiguration(
  options: ApplyRuntimeOptions,
  effect: RuntimeConfigurationEffect,
  dependencies: RuntimeDependencies = {},
) {
  const { bundle, compose, identity } = readRuntimeBundle(
    options.bundleDirectory,
  );
  const observe = async () => {
    const { containers } = await observeReadyState(options, dependencies);
    const sandbox = containers.find(
      (container) =>
        container.Config.Labels?.['com.docker.compose.service'] === 'sandbox',
    );
    return spawnerBootSchema.parse({
      containerId: sandbox?.Id,
      startedAt: sandbox?.State.StartedAt,
    });
  };
  return activateConfiguration(
    options,
    effect,
    identity,
    observe,
    async () => {
      await waitForRuntime(options, bundle, compose, dependencies);
    },
    dependencies,
  );
}
