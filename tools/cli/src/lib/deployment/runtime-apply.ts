import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { z } from 'zod';

import { externalDepError } from '../../utils/fail';
import { BACKUP_VOLUME } from '../backup/constants';
import { runtimeCommand, runtimeSleep } from './runtime-command';
import {
  parseRuntimeEnvironment,
  prepareRuntimeEnvironment,
} from './runtime-env';
import {
  atomicRuntimeFile,
  hash,
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
function receiptInput(options: ApplyRuntimeOptions): string {
  return hash(
    JSON.stringify({
      stateDirectory: options.stateDirectory,
      composeProject: options.composeProject,
      name: options.name,
      origin: options.origin,
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
  let origin: URL;
  try {
    origin = new URL(options.origin);
  } catch {
    requireRuntime(false, 'Invalid managed runtime origin.');
  }
  requireRuntime(
    origin.protocol === 'https:' &&
      !origin.username &&
      !origin.password &&
      origin.origin === options.origin &&
      !origin.port &&
      /^[a-z0-9.-]+$/.test(origin.hostname),
    'Managed production runtime requires a canonical HTTPS origin.',
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
          ? `${options.composeProject}_${source}`
          : source.startsWith('./')
            ? join(options.stateDirectory, 'src', source.slice(2))
            : source,
        target,
        readonly: mode === 'ro',
      };
    });
    requireRuntime(
      container.Mounts.length === expected.length,
      'Existing runtime mounts differ from the managed topology.',
    );
    for (const mount of expected) {
      requireRuntime(
        container.Mounts.some(
          (actual) =>
            actual.Destination === mount.target &&
            actual.Type === (mount.named ? 'volume' : 'bind') &&
            (mount.named ? actual.Name : actual.Source) === mount.source &&
            actual.RW === !mount.readonly,
        ),
        'Existing runtime data-volume or host-mount identity differs.',
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

function healthy(
  containers: RuntimeContainer[],
  bundle: RuntimeBundle,
  compose: ComposeDocument,
): boolean {
  return (
    containers.length === RUNTIME_SERVICES.length &&
    containers.every((container) => {
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
      const healthRequired = check !== undefined && !disabled;
      return (
        container.State.Running &&
        ((!healthRequired && container.State.Health === undefined) ||
          container.State.Health?.Status === 'healthy') &&
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

async function waitForRuntime(
  options: ApplyRuntimeOptions,
  bundle: RuntimeBundle,
  compose: ComposeDocument,
  dependencies: RuntimeDependencies,
): Promise<RuntimeContainer[]> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const containers = await runtimeContainers(
      options.composeProject,
      dependencies,
    );
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
  throw externalDepError(
    'Managed runtime did not become healthy; pending state is retained for recovery.',
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
  let containers = await runtimeContainers(
    options.composeProject,
    dependencies,
  );
  assertContainerCustody(containers, compose, options);
  await assertFixedContainerNames(containers, compose, dependencies);
  const volumeResult = await runtimeCommand(
    ['volume', 'ls', '--format', '{{.Name}}'],
    dependencies,
  );
  const projectVolumes = volumeResult.stdout
    .split('\n')
    .filter((name) => name.startsWith(`${options.composeProject}_`));
  requireRuntime(
    projectVolumes.every(
      (name) =>
        name === `${options.composeProject}_${BACKUP_VOLUME}` ||
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
          environment.TLS_MODE === options.tlsMode,
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
    !healthy(containers, bundle, compose) ||
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
    { cwd: sourceDirectory, timeout: 600 },
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
