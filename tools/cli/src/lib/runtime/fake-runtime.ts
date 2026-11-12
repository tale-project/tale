/**
 * An in-memory stack for tests: `FakeRuntime` answers every `StackRuntime`
 * verb from a model of instances, images, volumes and networks, and
 * `fakeDockerCli` answers Docker's command line from the same model. The
 * shared contract suite (`runtime-contract.test.ts`) runs the Docker runtime
 * over the command-line fake and `FakeRuntime` itself, so the two stay one
 * behaviour; the deploy argv guard records what a whole deploy asks Docker.
 *
 * Test support only: nothing the CLI ships imports this module.
 */

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

import type { DeploymentColor } from '../compose/types';
import { parseContainerVersionInspect } from '../docker/parse-container-version';
import { getProjectId } from '../project/project-context';
import {
  type ConvergeScope,
  type CopyOutOptions,
  type CopyResult,
  type ExecOptions,
  type ExecResult,
  type FileOwner,
  type HealthState,
  type InstanceInfo,
  type InstanceMount,
  type InstanceSummary,
  type LogOptions,
  type OneShotJob,
  type ProbeResult,
  type RuntimeCheck,
  type RuntimeEngine,
  type StackRuntime,
  type StackTarget,
  type WaitHealthyOptions,
  type WaitServiceHealthyOptions,
  pickInstanceEnvironment,
} from './types';

const PROJECT_LABEL = 'com.docker.compose.project';
const SERVICE_LABEL = 'com.docker.compose.service';
const NUMBER_LABEL = 'com.docker.compose.container-number';
const ONEOFF_LABEL = 'com.docker.compose.oneoff';
const VERSION_LABEL = 'org.opencontainers.image.version';
const STARTED_AT = '2026-11-12T00:00:00Z';

/** The CLI package, where `bun test` runs. */
const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Set to a test file's path while that file runs in a process of its own. */
export const ISOLATED_TEST_VARIABLE = 'TALE_RUNTIME_ISOLATED_TEST';

/**
 * Run one test file in a `bun test` of its own. Bun's `mock.module` is
 * process-wide: a suite that drives the real `lib/docker` modules over the
 * fake command line must neither meet the module mocks earlier files left
 * behind nor leave its own for the files after it. The file sees
 * `ISOLATED_TEST_VARIABLE` set to its own path, and `env` besides (a child
 * resolves the commands it spawns through the `PATH` it starts with).
 */
export async function runIsolatedTestFile(
  file: string,
  env: Record<string, string> = {},
): Promise<{ exitCode: number; output: string }> {
  const child = Bun.spawn(
    [
      process.execPath,
      'test',
      '--timeout',
      '60000',
      `./${relative(PACKAGE_ROOT, file).replaceAll('\\', '/')}`,
    ],
    {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, ...env, [ISOLATED_TEST_VARIABLE]: file },
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, output: `${stdout}${stderr}` };
}

export interface FakeImage {
  reference: string;
  id: string;
  labels: Record<string, string>;
  environment: Record<string, string>;
}

export interface FakeInstance {
  id: string;
  name: string;
  stack: string;
  service: string;
  index: number;
  oneOff: boolean;
  image: string;
  imageId: string;
  state: string;
  health: HealthState;
  environment: Record<string, string>;
  labels: Record<string, string>;
  mounts: InstanceMount[];
  networks: Set<string>;
  log: string[];
  /** Files inside the instance, by absolute path. */
  files: Map<string, string>;
  restartCount: number;
}

export interface FakeInstanceSeed {
  name?: string;
  stack: string;
  service: string;
  index?: number;
  oneOff?: boolean;
  image: string;
  state?: string;
  health?: HealthState;
  environment?: Record<string, string>;
  mounts?: InstanceMount[];
  networks?: string[];
  log?: string[];
  files?: Record<string, string>;
}

/** What an instance answers to one exec; `undefined` = the default. */
export type FakeExecHandler = (
  instance: FakeInstance,
  argv: readonly string[],
  stdin: string | undefined,
) => ExecResult | undefined;

/** What a helper job answers; `undefined` = the default. */
export type FakeJobHandler = (job: OneShotJob) => ExecResult | undefined;

function ok(stdout = ''): ExecResult {
  return { success: true, stdout, stderr: '', exitCode: 0 };
}

function failed(stderr: string, exitCode = 1): ExecResult {
  return { success: false, stdout: '', stderr, exitCode };
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function colourOf(stack: string): DeploymentColor | undefined {
  if (stack.endsWith('-blue')) return 'blue';
  if (stack.endsWith('-green')) return 'green';
  return undefined;
}

function tagOf(reference: string): string {
  const slash = reference.lastIndexOf('/');
  const colon = reference.lastIndexOf(':');
  return colon > slash ? reference.slice(colon + 1) : 'latest';
}

/** `KEY=value` lines or a map, as a compose `environment` may hold them. */
function environmentOf(value: unknown): Record<string, string> {
  const environment: Record<string, string> = {};
  if (Array.isArray(value)) {
    for (const entry of value) {
      const line = String(entry);
      const separator = line.indexOf('=');
      if (separator > 0)
        environment[line.slice(0, separator)] = line.slice(separator + 1);
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value))
      environment[key] = entry === null ? '' : String(entry);
  }
  return environment;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** Every file below `dir`, by its path relative to it. */
function readTree(dir: string, base = dir): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      for (const [subpath, content] of readTree(path, base))
        files.set(subpath, content);
    } else {
      files.set(
        path.slice(base.length + 1).replaceAll('\\', '/'),
        readFileSync(path, 'utf8'),
      );
    }
  }
  return files;
}

/** The answers Tale's own images give: the control doors and the ledger. */
function defaultExec(
  _instance: FakeInstance,
  argv: readonly string[],
  stdin: string | undefined,
): ExecResult {
  const line = argv.join(' ');
  if (line.includes('/api/control/drain-status'))
    return ok('{"draining":true,"inFlight":0}');
  if (line.includes('drain-status')) return ok('{"inFlight":0}');
  if (stdin?.includes('app_migrations'))
    return ok('{"schema":"public","ids":["0001_initial.sql"]}');
  return ok();
}

export class FakeRuntime implements StackRuntime {
  readonly engine: RuntimeEngine;
  readonly instances = new Map<string, FakeInstance>();
  readonly images = new Map<string, FakeImage>();
  readonly volumes = new Map<string, Map<string, string>>();
  readonly networks = new Map<string, { internal: boolean; ipv6: boolean }>();
  /** Every verb this runtime answered, in order, with its subject. */
  readonly journal: string[] = [];
  execHandler: FakeExecHandler = () => undefined;
  jobHandler: FakeJobHandler = () => undefined;
  /** Images whose pull the registry refuses. */
  readonly unpullable = new Set<string>();
  /** Every instance and image ID this model handed out, with its name. */
  readonly issuedIds = new Map<string, string>();
  private generation = 0;

  constructor(options: { engine?: RuntimeEngine } = {}) {
    this.engine = options.engine ?? 'docker';
  }

  // The model

  seedImage(
    reference: string,
    labels: Record<string, string> = {},
    environment: Record<string, string> = {},
  ): FakeImage {
    const image: FakeImage = {
      reference,
      id: `sha256:${sha256(`image:${reference}`)}`,
      labels: { [VERSION_LABEL]: tagOf(reference), ...labels },
      environment: { TALE_VERSION: tagOf(reference), ...environment },
    };
    this.images.set(reference, image);
    this.issuedIds.set(image.id.slice('sha256:'.length), `image ${reference}`);
    return image;
  }

  seedVolume(name: string, files: Record<string, string> = {}): void {
    this.volumes.set(name, new Map(Object.entries(files)));
  }

  seedNetwork(name: string, options = { internal: false, ipv6: false }): void {
    this.networks.set(name, options);
  }

  seedInstance(seed: FakeInstanceSeed): FakeInstance {
    const index = seed.index ?? 1;
    const name = seed.name ?? `${seed.stack}-${seed.service}-${index}`;
    const image = this.images.get(seed.image) ?? this.seedImage(seed.image);
    this.generation += 1;
    const oneOff = seed.oneOff ?? false;
    const instance: FakeInstance = {
      id: sha256(`instance:${name}:${this.generation}`),
      name,
      stack: seed.stack,
      service: seed.service,
      index,
      oneOff,
      image: image.reference,
      imageId: image.id,
      state: seed.state ?? 'running',
      health: seed.health ?? 'healthy',
      environment: { ...image.environment, ...seed.environment },
      labels: {
        ...image.labels,
        [PROJECT_LABEL]: seed.stack,
        [SERVICE_LABEL]: seed.service,
        [NUMBER_LABEL]: String(index),
        [ONEOFF_LABEL]: oneOff ? 'True' : 'False',
      },
      mounts: seed.mounts ?? [],
      networks: new Set(seed.networks ?? []),
      log: seed.log ?? [],
      files: new Map(Object.entries(seed.files ?? {})),
      restartCount: 0,
    };
    this.instances.set(name, instance);
    this.issuedIds.set(instance.id, name);
    return instance;
  }

  /** By name, full ID or an ID prefix of at least 12 characters. */
  find(reference: string): FakeInstance | undefined {
    const byName = this.instances.get(reference);
    if (byName) return byName;
    if (reference.length < 12) return undefined;
    return [...this.instances.values()].find((instance) =>
      instance.id.startsWith(reference),
    );
  }

  /** Bring the scoped services of a compose document up, as `compose up -d`
   *  does: replace what changed, keep what did not, drop surplus replicas. */
  composeUp(stack: string, document: string, scope: ConvergeScope): void {
    const services = record(record(parse(document)).services);
    for (const service of scope.services) {
      const spec = record(services[service]);
      const reference = String(spec.image ?? `${service}:latest`);
      const count = scope.scale?.[service] ?? 1;
      const pinned =
        typeof spec.container_name === 'string' ? spec.container_name : null;
      const healthcheck = record(spec.healthcheck);
      const health: HealthState =
        spec.healthcheck === undefined || healthcheck.disable === true
          ? 'none'
          : 'healthy';
      for (const existing of this.replicas(stack, service))
        if (existing.index > count) this.instances.delete(existing.name);
      for (let index = 1; index <= count; index += 1) {
        const name =
          pinned !== null && count === 1
            ? pinned
            : `${stack}-${service}-${index}`;
        const current = this.instances.get(name);
        if (
          current !== undefined &&
          current.image === reference &&
          scope.forceRecreate !== true
        ) {
          current.state = 'running';
          continue;
        }
        if (current !== undefined) this.instances.delete(name);
        this.seedInstance({
          name,
          stack,
          service,
          index,
          image: reference,
          health,
          environment: environmentOf(spec.environment),
        });
      }
    }
  }

  private replicas(stack: string, service?: string): FakeInstance[] {
    return [...this.instances.values()]
      .filter(
        (instance) =>
          instance.stack === stack &&
          !instance.oneOff &&
          (service === undefined || instance.service === service),
      )
      .sort((a, b) => a.service.localeCompare(b.service) || a.index - b.index);
  }

  /** What one exec of `argv` in `instance` answers. */
  answerExec(
    instance: FakeInstance,
    argv: readonly string[],
    stdin: string | undefined,
  ): ExecResult {
    if (instance.state !== 'running')
      return failed(
        `Error response from daemon: container ${instance.id} is not running`,
      );
    return (
      this.execHandler(instance, argv, stdin) ??
      defaultExec(instance, argv, stdin)
    );
  }

  /** What one helper job answers: the snapshot scripts the CLI runs. */
  answerJob(job: OneShotJob): ExecResult {
    const custom = this.jobHandler(job);
    if (custom !== undefined) return custom;
    const backup = job.mounts.find((mount) => mount.target === '/backup');
    const files =
      backup === undefined ? undefined : this.volumes.get(backup.volume);
    for (const mount of job.mounts)
      if (!this.volumes.has(mount.volume)) this.seedVolume(mount.volume);
    const script = job.argv.at(-1) ?? '';
    const tar = /tar czf \/backup\/([^/]+)\/([a-z-]+)\.tar\.gz/.exec(script);
    if (tar) {
      const [, id = '', volume = ''] = tar;
      files?.set(`${id}/${volume}.tar.gz`, `archive of ${volume}`);
      return ok(`${sha256(`archive:${volume}`)}  ${volume}.tar.gz\n4096`);
    }
    const manifest = /^cat > \/backup\/([^/]+)\/manifest\.json$/.exec(script);
    if (manifest) {
      files?.set(`${manifest[1]}/manifest.json`, job.stdin ?? '');
      return ok();
    }
    if (script.includes('/backup/*/manifest.json'))
      return ok(
        [...(files?.entries() ?? [])]
          .filter(([path]) => path.endsWith('/manifest.json'))
          .map(([, content]) => content)
          .join('\n'),
      );
    const removal = /^rm -rf \/backup\/(.+)$/.exec(script);
    if (removal) {
      for (const path of files?.keys() ?? [])
        if (path.startsWith(`${removal[1]}/`)) files?.delete(path);
      return ok();
    }
    if (script.includes('find /data -mindepth 1 -maxdepth 1'))
      return ok('/data/default');
    return ok();
  }

  private record(verb: string, subject = ''): void {
    this.journal.push(subject === '' ? verb : `${verb} ${subject}`);
  }

  private summary(instance: FakeInstance): InstanceSummary {
    return {
      stack: instance.stack,
      service: instance.service,
      index: instance.index,
      ...(colourOf(instance.stack) === undefined
        ? {}
        : { colour: colourOf(instance.stack) }),
      oneOff: instance.oneOff,
      name: instance.name,
      running: instance.state === 'running',
      state: instance.state,
    };
  }

  // Readiness

  async probe(): Promise<ProbeResult> {
    this.record('probe');
    return { status: 'ready', detail: 'fake runtime' };
  }

  async checkReachable(): Promise<RuntimeCheck> {
    return { status: 'ok', detail: 'fake runtime' };
  }

  async checkEngine(): Promise<RuntimeCheck> {
    return { status: 'ok', detail: 'fake runtime' };
  }

  async cgroupVersion(): Promise<1 | 2 | null> {
    return 2;
  }

  // Census and readback

  async list(filter: {
    stack: string;
    service?: string;
  }): Promise<InstanceSummary[]> {
    return this.replicas(filter.stack, filter.service).map((instance) =>
      this.summary(instance),
    );
  }

  async listByName(
    fragment: string,
  ): Promise<Array<{ name: string; status: string }>> {
    return [...this.instances.values()]
      .filter((instance) => instance.name.includes(fragment))
      .map((instance) => ({
        name: instance.name,
        status: instance.state === 'running' ? 'Up' : 'Exited (0)',
      }));
  }

  async exists(name: string): Promise<boolean> {
    return this.find(name) !== undefined;
  }

  async isRunning(name: string): Promise<boolean> {
    const instance = this.find(name);
    return (
      instance !== undefined &&
      ['running', 'restarting', 'paused'].includes(instance.state)
    );
  }

  async state(name: string): Promise<string | null> {
    return this.find(name)?.state ?? null;
  }

  async version(name: string): Promise<string | null> {
    const instance = this.find(name);
    if (instance === undefined) return null;
    return parseContainerVersionInspect(
      [
        instance.labels[VERSION_LABEL] ?? '<no value>',
        instance.image,
        ...Object.entries(instance.environment).map(
          ([key, value]) => `${key}=${value}`,
        ),
      ].join('\n'),
    );
  }

  async health(name: string): Promise<HealthState> {
    return this.find(name)?.health ?? 'none';
  }

  async inspect(name: string): Promise<InstanceInfo | null> {
    const instance = this.find(name);
    if (instance === undefined) return null;
    return {
      ...this.summary(instance),
      startedAt: STARTED_AT,
      restarted: instance.restartCount > 0,
      image: {
        reference: instance.image,
        digest: instance.imageId,
        version: instance.labels[VERSION_LABEL] ?? null,
        revision: instance.labels['org.opencontainers.image.revision'] ?? null,
        automationWriterProtocol:
          instance.labels['io.tale.automation-writer-protocol'] ?? null,
      },
      environment: pickInstanceEnvironment(instance.environment),
      environmentDigest: null,
      mounts: structuredClone(instance.mounts),
      address: null,
      configDigest: null,
    };
  }

  // Images

  async pull(image: string): Promise<boolean> {
    this.record('pull', image);
    if (this.unpullable.has(image)) return false;
    if (!this.images.has(image)) this.seedImage(image);
    return true;
  }

  async imagePresent(image: string): Promise<boolean> {
    return this.images.has(image);
  }

  async tag(source: string, alias: string): Promise<ExecResult> {
    const image = this.images.get(source);
    if (image === undefined)
      return failed(`Error response from daemon: No such image: ${source}`);
    this.images.set(alias, { ...image, reference: alias });
    return ok();
  }

  // Volumes and networks

  async volumeExists(name: string): Promise<boolean> {
    return this.volumes.has(name);
  }

  async ensureVolumes(
    names: readonly string[],
    prefix = `${getProjectId()}_`,
  ): Promise<boolean> {
    for (const name of names)
      if (!this.volumes.has(`${prefix}${name}`))
        this.seedVolume(`${prefix}${name}`);
    return true;
  }

  async removeVolume(name: string): Promise<boolean> {
    const used = [...this.instances.values()].some((instance) =>
      instance.mounts.some((mount) => mount.source === name),
    );
    if (used) return false;
    this.volumes.delete(name);
    this.record('removeVolume', name);
    return true;
  }

  async volumeRemovalHint(name: string): Promise<string | null> {
    return this.volumes.has(name) ? `remove the volume ${name}` : null;
  }

  async migrateConfigVolume(prefix: string): Promise<void> {
    this.record('migrateConfigVolume', prefix);
  }

  async ensureNetwork(name: string): Promise<boolean> {
    const full = `${getProjectId()}_${name}`;
    if (!this.networks.has(full)) this.seedNetwork(full);
    return true;
  }

  async ensureSandboxNetwork(): Promise<boolean> {
    const existing = this.networks.get('tale-sandbox-net');
    if (existing === undefined) {
      this.seedNetwork('tale-sandbox-net', { internal: true, ipv6: false });
      return true;
    }
    return existing.internal;
  }

  async pruneNetworks(): Promise<ExecResult> {
    this.record('pruneNetworks');
    return ok();
  }

  async volumeUsers(volume: string): Promise<string[]> {
    return [...this.instances.values()]
      .filter(
        (instance) =>
          instance.state === 'running' &&
          instance.mounts.some((mount) => mount.source === volume),
      )
      .map((instance) => instance.name);
  }

  async quiesce<T>(
    volumes: readonly string[],
    work: (frozenCount: number) => Promise<T>,
  ): Promise<T> {
    const users = new Set<string>();
    for (const volume of volumes)
      for (const name of await this.volumeUsers(volume)) users.add(name);
    const frozen = [...users].flatMap((name) => this.find(name) ?? []);
    for (const instance of frozen) instance.state = 'paused';
    try {
      return await work(frozen.length);
    } finally {
      for (const instance of frozen) instance.state = 'running';
    }
  }

  // Lifecycle

  async converge(
    target: StackTarget,
    scope: ConvergeScope,
  ): Promise<ExecResult> {
    this.record('converge', `${target.stack} ${scope.services.join(',')}`);
    this.composeUp(target.stack, target.compose, scope);
    return ok();
  }

  async waitHealthy(
    name: string,
    _options: WaitHealthyOptions,
  ): Promise<boolean> {
    const instance = this.find(name);
    return (
      instance !== undefined &&
      instance.state === 'running' &&
      (instance.health === 'healthy' || instance.health === 'none')
    );
  }

  async waitServiceHealthy(
    stack: string,
    service: string,
    options: WaitServiceHealthyOptions,
  ): Promise<boolean> {
    const replicas = this.replicas(stack, service);
    if (replicas.length < options.expectedReplicas) return false;
    for (const replica of replicas)
      if (!(await this.waitHealthy(replica.name, options))) return false;
    return true;
  }

  async stop(name: string): Promise<boolean> {
    const instance = this.find(name);
    if (instance === undefined) return false;
    instance.state = 'exited';
    this.record('stop', name);
    return true;
  }

  async remove(name: string): Promise<boolean> {
    const instance = this.find(name);
    if (instance !== undefined) this.instances.delete(instance.name);
    this.record('remove', name);
    return true;
  }

  async admit(stack: string, services: readonly string[]): Promise<void> {
    this.record('admit', `${stack} ${services.join(',')}`);
  }

  async withdraw(stack: string, services: readonly string[]): Promise<number> {
    let cut = 0;
    for (const service of services)
      for (const instance of this.replicas(stack, service)) {
        if (instance.state !== 'running') continue;
        cut += instance.networks.size;
        instance.networks.clear();
      }
    this.record('withdraw', `${stack} ${services.join(',')}`);
    return cut;
  }

  onInterrupt(stacks: readonly string[]): void {
    for (const stack of stacks)
      for (const instance of this.instances.values())
        if (instance.stack === stack && !instance.oneOff)
          this.instances.delete(instance.name);
    this.record('onInterrupt', stacks.join(','));
  }

  // Exec, files, logs

  async exec(
    name: string,
    argv: readonly string[],
    options: ExecOptions = {},
  ): Promise<ExecResult> {
    const instance = this.find(name);
    if (instance === undefined)
      return failed(`Error response from daemon: No such container: ${name}`);
    return this.answerExec(instance, argv, options.stdin);
  }

  async copyIn(
    name: string,
    dir: string,
    target: string,
    owner?: FileOwner,
  ): Promise<CopyResult> {
    const instance = this.find(name);
    if (instance === undefined)
      return {
        success: false,
        stage: 'copy',
        detail: `No such container: ${name}`,
      };
    for (const [subpath, content] of readTree(dir))
      instance.files.set(posix.join(target, subpath), content);
    this.record(
      'copyIn',
      `${name}:${target}${owner ? ` ${owner.user}:${owner.group}` : ''}`,
    );
    return { success: true };
  }

  async copyOut(
    name: string,
    source: string,
    dir: string,
    options: CopyOutOptions,
  ): Promise<ExecResult> {
    const instance = this.find(name);
    if (instance === undefined)
      return failed(`Error response from daemon: No such container: ${name}`);
    const prefix = `${source.replace(/\/+$/, '')}/`;
    const entries = [...instance.files].filter(([path]) =>
      path.startsWith(prefix),
    );
    const bytes = entries.reduce(
      (sum, [, content]) => sum + Buffer.byteLength(content),
      0,
    );
    if (bytes > options.maxBytes)
      return failed(`copy of ${bytes} bytes exceeds ${options.maxBytes}`);
    for (const [path, content] of entries) {
      const local = join(dir, path.slice(prefix.length));
      mkdirSync(dirname(local), { recursive: true });
      writeFileSync(local, content, { mode: 0o600 });
    }
    return ok();
  }

  async logs(
    name: string,
    options: LogOptions,
    onLine?: (line: string) => void,
  ): Promise<number> {
    const instance = this.find(name);
    if (instance === undefined) return 1;
    const lines =
      options.tail === undefined
        ? instance.log
        : instance.log.slice(-options.tail);
    for (const line of lines) {
      if (onLine) onLine(line);
      else process.stdout.write(`${line}\n`);
    }
    return 0;
  }

  // Helpers

  async oneShot(job: OneShotJob): Promise<ExecResult> {
    this.record('oneShot', job.image);
    return this.answerJob(job);
  }
}

/** The `{{…}}` placeholders the CLI's `ps --format` strings use. */
function renderPs(
  format: string,
  instance: FakeInstance,
  noTrunc: boolean,
): string {
  return format
    .replaceAll(
      /\{\{\.Label "([^"]+)"\}\}/g,
      (_match, key: string) => instance.labels[key] ?? '',
    )
    .replaceAll('{{.Names}}', instance.name)
    .replaceAll('{{.ID}}', noTrunc ? instance.id : instance.id.slice(0, 12))
    .replaceAll('{{.State}}', instance.state)
    .replaceAll(
      '{{.Status}}',
      instance.state === 'running' ? 'Up 2 minutes' : 'Exited (0) 1 minute ago',
    )
    .replaceAll('{{.Image}}', instance.image);
}

function inspectJson(fake: FakeRuntime, instance: FakeInstance) {
  return {
    Id: instance.id,
    Name: `/${instance.name}`,
    Image: instance.imageId,
    RestartCount: instance.restartCount,
    State: {
      Status: instance.state,
      Running: instance.state === 'running',
      Paused: instance.state === 'paused',
      Dead: instance.state === 'dead',
      Pid: instance.state === 'running' ? 4242 : 0,
      StartedAt: STARTED_AT,
      ...(instance.health === 'none'
        ? {}
        : { Health: { Status: instance.health } }),
    },
    Config: {
      Image: instance.image,
      Labels: instance.labels,
      Env: Object.entries(instance.environment).map(
        ([key, value]) => `${key}=${value}`,
      ),
    },
    HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
    Mounts: instance.mounts.map((mount) => ({
      Type: mount.kind === 'volume' ? 'volume' : 'bind',
      ...(mount.kind === 'volume' ? { Name: mount.source } : {}),
      Source: mount.source,
      Destination: mount.target,
      RW: !mount.readOnly,
    })),
    NetworkSettings: {
      Networks: Object.fromEntries(
        [...instance.networks].map((network) => [
          network,
          { IPAddress: `172.18.0.${(fake.instances.size % 200) + 2}` },
        ]),
      ),
    },
  };
}

function imageJson(image: FakeImage) {
  const repository = image.reference.slice(
    0,
    image.reference.length - tagOf(image.reference).length - 1,
  );
  return {
    Id: image.id,
    RepoTags: [image.reference],
    RepoDigests: [
      `${repository}@sha256:${sha256(`digest:${image.reference}`)}`,
    ],
    Os: 'linux',
    Architecture: 'amd64',
    Config: {
      Labels: image.labels,
      Env: Object.entries(image.environment).map(
        ([key, value]) => `${key}=${value}`,
      ),
    },
  };
}

/** Pull the `--flag value` and `--flag` options off an argv. */
function parseFlags(args: readonly string[], valued: readonly string[]) {
  const flags = new Map<string, string[]>();
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? '';
    if (valued.includes(arg)) {
      flags.set(arg, [...(flags.get(arg) ?? []), args[index + 1] ?? '']);
      index += 1;
    } else if (arg.startsWith('-') && rest.length === 0) {
      flags.set(arg, [...(flags.get(arg) ?? []), '']);
    } else {
      rest.push(arg);
    }
  }
  return { flags, rest };
}

function containerInspect(
  fake: FakeRuntime,
  args: readonly string[],
): ExecResult {
  const { flags, rest } = parseFlags(args, ['--format']);
  const instances = rest.map((name) => fake.find(name));
  const missing = rest.find((_name, index) => instances[index] === undefined);
  if (missing !== undefined)
    return failed(`Error: No such container: ${missing}`);
  const found = instances.flatMap((instance) => instance ?? []);
  const format = flags.get('--format')?.[0];
  if (format === undefined)
    return ok(
      JSON.stringify(found.map((instance) => inspectJson(fake, instance))),
    );
  const instance = found[0];
  if (instance === undefined) return failed('fake docker: nothing to inspect');
  switch (format) {
    case '{{.Id}}':
      return ok(instance.id);
    case '{{.State.Running}}':
      return ok(
        String(['running', 'restarting', 'paused'].includes(instance.state)),
      );
    case '{{.State.Status}}':
      return ok(instance.state);
    case '{{.State.Health.Status}}':
      return ok(instance.health === 'none' ? '<no value>' : instance.health);
    default:
      break;
  }
  if (
    format.startsWith(
      '{{index .Config.Labels "org.opencontainers.image.version"}}',
    )
  )
    return ok(
      `${instance.labels[VERSION_LABEL] ?? '<no value>'}\n${instance.image}\n${Object.entries(
        instance.environment,
      )
        .map(([key, value]) => `${key}=${value}\n`)
        .join('')}`,
    );
  if (format.startsWith('{{.Name}} {{if .State.Health}}'))
    return ok(
      instance.health === 'none'
        ? `/${instance.name} none 0 0 0`
        : `/${instance.name} ${instance.health} 5000000000 10000000000 3`,
    );
  return failed(`fake docker: unsupported inspect format ${format}`);
}

function ps(fake: FakeRuntime, args: readonly string[]): ExecResult {
  const { flags } = parseFlags(args, ['--filter', '--format']);
  const all = flags.has('-a') || flags.has('-aq');
  const quiet = flags.has('-q') || flags.has('-aq');
  const noTrunc = flags.has('--no-trunc');
  const matches = [...fake.instances.values()].filter((instance) => {
    if (!all && instance.state !== 'running') return false;
    for (const filter of flags.get('--filter') ?? []) {
      const [kind = '', ...value] = filter.split('=');
      const operand = value.join('=');
      if (kind === 'label') {
        const [key = '', ...expected] = operand.split('=');
        if (expected.length === 0) {
          if (!(key in instance.labels)) return false;
        } else if (instance.labels[key] !== expected.join('=')) return false;
      } else if (kind === 'volume') {
        if (!instance.mounts.some((mount) => mount.source === operand))
          return false;
      } else if (kind === 'name') {
        if (!instance.name.includes(operand)) return false;
      } else return false;
    }
    return true;
  });
  const format = quiet ? '{{.ID}}' : (flags.get('--format')?.[0] ?? '{{.ID}}');
  return ok(
    matches.map((instance) => renderPs(format, instance, noTrunc)).join('\n'),
  );
}

function compose(fake: FakeRuntime, args: readonly string[]): ExecResult {
  const { flags, rest } = parseFlags(args, ['-p', '-f']);
  const stack = flags.get('-p')?.[0] ?? getProjectId();
  const files = flags.get('-f') ?? [];
  if (rest[0] !== 'up') return failed(`fake docker: compose ${rest[0] ?? ''}`);
  const up = parseFlags(rest.slice(1), ['--scale']);
  const scale: Record<string, number> = {};
  for (const entry of up.flags.get('--scale') ?? []) {
    const [service = '', count = '1'] = entry.split('=');
    scale[service] = Number(count);
  }
  const document = files[0] === undefined ? '' : readFileSync(files[0], 'utf8');
  fake.composeUp(stack, document, {
    services: up.rest,
    scale,
    forceRecreate: up.flags.has('--force-recreate'),
  });
  return ok();
}

function run(
  fake: FakeRuntime,
  args: readonly string[],
  stdin: string | undefined,
): ExecResult {
  const { flags, rest } = parseFlags(args, ['-v']);
  const [image = '', ...argv] = rest;
  const mounts = (flags.get('-v') ?? []).map((spec) => {
    const [volume = '', target = '', mode] = spec.split(':');
    return { volume, target, readOnly: mode === 'ro' };
  });
  return fake.answerJob({
    image,
    mounts,
    argv,
    ...(stdin === undefined ? {} : { stdin }),
  });
}

/**
 * Docker's command line over a `FakeRuntime`'s model: the executor the Docker
 * runtime runs against in tests. It answers exactly the argv shapes the CLI
 * sends and refuses any other, so a new shape is a failing test rather than a
 * silent success.
 */
export function fakeDockerCli(fake: FakeRuntime) {
  // `exec` hands its callers trimmed output, so the fake does too.
  return async (
    command: string,
    args: readonly string[],
    execOptions: { stdin?: string } = {},
  ): Promise<ExecResult> => {
    const result = await answerDocker(fake, command, args, execOptions);
    return {
      ...result,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  };
}

async function answerDocker(
  fake: FakeRuntime,
  command: string,
  args: readonly string[],
  execOptions: { stdin?: string },
): Promise<ExecResult> {
  if (command !== 'docker') return failed(`fake docker: ${command}`, 127);
  const [verb = '', sub = '', ...rest] = args;
  switch (verb) {
    case 'ps':
      return ps(fake, args.slice(1));
    case 'container':
      if (sub === 'inspect') return containerInspect(fake, rest);
      break;
    case 'image': {
      if (sub !== 'inspect') break;
      const images = rest.map(
        (reference) =>
          fake.images.get(reference) ??
          [...fake.images.values()].find((image) => image.id === reference),
      );
      if (images.some((image) => image === undefined))
        return failed('Error response from daemon: No such image');
      return ok(
        JSON.stringify(
          images.flatMap((image) => (image ? [imageJson(image)] : [])),
        ),
      );
    }
    case 'volume': {
      const name = args.at(-1) ?? '';
      if (sub === 'inspect')
        return fake.volumes.has(name)
          ? ok(JSON.stringify([{ Name: name }]))
          : failed(`Error response from daemon: get ${name}: no such volume`);
      if (sub === 'create') {
        if (!fake.volumes.has(name)) fake.seedVolume(name);
        return ok(name);
      }
      if (sub === 'rm') {
        if (!fake.volumes.has(name))
          return failed(
            `Error response from daemon: get ${name}: no such volume`,
          );
        return (await fake.removeVolume(name))
          ? ok(name)
          : failed(
              `Error response from daemon: remove ${name}: volume is in use`,
            );
      }
      if (sub === 'ls')
        return ok(
          [...fake.volumes.keys()]
            .map((volume) => JSON.stringify({ Name: volume }))
            .join('\n'),
        );
      break;
    }
    case 'network': {
      const name = args.at(-1) ?? '';
      if (sub === 'inspect') {
        const network = fake.networks.get(name);
        if (network === undefined)
          return failed(
            `Error response from daemon: network ${name} not found`,
          );
        return args.includes('--format')
          ? ok(`${network.internal}|${network.ipv6}`)
          : ok(JSON.stringify([{ Name: name }]));
      }
      if (sub === 'create') {
        fake.seedNetwork(name, {
          internal: args.includes('--internal'),
          ipv6: !args.includes('--ipv6=false'),
        });
        return ok(name);
      }
      if (sub === 'disconnect') {
        const instance = fake.find(name);
        const network = args[2] ?? '';
        if (instance === undefined || !instance.networks.delete(network))
          return failed(
            `Error response from daemon: container ${name} is not connected to ${network}`,
          );
        return ok();
      }
      if (sub === 'prune') return ok();
      break;
    }
    case 'info':
      return ok('2');
    case 'pull': {
      const reference = args.at(-1) ?? '';
      return (await fake.pull(reference))
        ? ok()
        : failed(
            `Error response from daemon: manifest for ${reference} not found`,
          );
    }
    case 'tag':
      return fake.tag(sub, rest[0] ?? '');
    case 'compose':
      return compose(fake, args.slice(1));
    case 'stop': {
      const name = args.at(-1) ?? '';
      return (await fake.stop(name))
        ? ok(name)
        : failed(`Error response from daemon: No such container: ${name}`);
    }
    case 'rm': {
      const name = args.at(-1) ?? '';
      if (fake.find(name) === undefined)
        return failed(`Error response from daemon: No such container: ${name}`);
      await fake.remove(name);
      return ok(name);
    }
    case 'pause':
    case 'unpause': {
      const instance = fake.find(sub);
      if (instance === undefined)
        return failed(`Error response from daemon: No such container: ${sub}`);
      instance.state = verb === 'pause' ? 'paused' : 'running';
      return ok(sub);
    }
    case 'exec': {
      const interactive = sub === '-i';
      const [name = '', ...argv] = interactive ? rest : [sub, ...rest];
      const instance = fake.find(name);
      if (instance === undefined)
        return failed(`Error response from daemon: No such container: ${name}`);
      return fake.answerExec(
        instance,
        argv,
        interactive ? execOptions.stdin : undefined,
      );
    }
    case 'cp': {
      const [from = '', to = ''] = [sub, rest[0] ?? ''];
      if (to.includes(':') && !/^[A-Za-z]:[\\/]/.test(to)) {
        const [name = '', target = ''] = to.split(/:(.*)/s);
        const dir = from.replace(/\/\.$/, '');
        const result = await fake.copyIn(name, dir, target);
        return result.success ? ok() : failed(result.detail);
      }
      const [name = '', source = ''] = from.split(/:(.*)/s);
      return fake.copyOut(name, source.replace(/\/\.$/, ''), to, {
        maxBytes: Number.MAX_SAFE_INTEGER,
        timeoutS: 0,
      });
    }
    case 'run':
      return run(fake, args.slice(1), execOptions.stdin);
    default:
      break;
  }
  return failed(`fake docker: unsupported command: docker ${args.join(' ')}`);
}
