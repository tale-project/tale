// An in-memory Incus, for the tests of what drives Incus: the REST API the
// client speaks, answered from a few maps, without a socket. It models what a
// caller relies on — async operations, ETag preconditions, ephemeral
// instances deleted on stop, volumes that are in use, a restricted project
// that refuses what a real one refuses — and records every request, so a
// test can say what was asked for as well as what came of it.
//
// What runs inside an instance is the image's business, which the API does
// not show: a test that needs it (a process that waits for a file before it
// boots) says so through `guest`. By default an instance's main process boots
// at once with the instance's environment.
//
// Exec runs nothing: a test says what a command does through `exec` (by
// default every command exits 0 and writes nothing). The client's stdin file
// and `timeout` wrappers are read back first, so a handler sees the command
// the caller asked for and its stdin. A websocket exec is served for real,
// by a `Bun.serve` on the loopback that the fake's client connects to.
//
// Not used by production code.

import { createHash } from 'node:crypto';

import {
  devicesOf,
  INCUS_STATUS,
  type IncusConfigMap,
  type IncusDevices,
  stringMap,
} from './api.ts';
import { IncusClient, type IncusFetch } from './client.ts';
import { unwrapExecCommand } from './exec.ts';
import { incusSizeBytes } from './units.ts';

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
  /** The raw bytes of a file write. */
  raw?: Uint8Array;
}

/** A file the fake holds, inside an instance or on a volume. */
export interface FakeFile {
  /** The content as text (empty for a directory). */
  content: string;
  mode: string;
  /** The exact bytes; absent where a test set `content` alone. */
  bytes?: Uint8Array;
  uid?: number;
  gid?: number;
  type?: 'file' | 'directory' | 'symlink';
}

/** One exec, as its handler sees it. */
export interface FakeExecCall {
  instance: FakeInstance;
  /** The command the caller asked for, its stdin file and `timeout`
   * wrappers taken off. */
  command: string[];
  /** The command line Incus was given. */
  argv: string[];
  /** The instance's environment with the exec's own on top. */
  environment: Record<string, string>;
  user: number;
  group: number;
  cwd: string | undefined;
  /** The `timeout` the command ran under, if any. */
  timeoutSeconds: number | undefined;
  mode: 'code' | 'record-output' | 'websocket';
}

/** What a handler does with the command's file descriptors. */
export interface FakeExecIo {
  /** stdin to its end (the stdin file's content, or the websocket's bytes
   * up to the end frame). */
  stdin(): Promise<Uint8Array>;
  /** stdin as it arrives. */
  stdinChunks(): AsyncIterable<Uint8Array>;
  write(fd: 1 | 2, data: string | Uint8Array): void;
  /** Signals sent on the control socket. */
  readonly signals: number[];
  /** Aborted once the control socket closes: the command is killed. */
  readonly killed: AbortSignal;
}

export type FakeExecHandler = (
  call: FakeExecCall,
  io: FakeExecIo,
) => number | Promise<number>;

export interface FakeInstance {
  name: string;
  status: 'Running' | 'Stopped' | 'Starting' | 'Error' | 'Frozen';
  ephemeral: boolean;
  config: IncusConfigMap;
  devices: IncusDevices;
  profiles: string[];
  createdAt: string;
  address: string | undefined;
  files: Map<string, FakeFile>;
  /** What the console holds; a read while the instance runs consumes it. */
  consoleLog: string;
  /** Log files by name (`lxc.log`), exec-output files included. */
  logs: Map<string, Uint8Array>;
  /** The environment the instance's main process booted with; undefined
   * until it has (a guest that waits has not, see `FakeGuest`). */
  bootEnv: Record<string, string> | undefined;
  version: number;
  /** When it last reached Running (the state's `started_at`); empty until
   * it has. */
  startedAt: string;
}

export interface FakeVolumeSnapshot {
  name: string;
  createdAt: string;
  expiresAt: string;
  config: IncusConfigMap;
  files: Map<string, FakeFile>;
}

export interface FakeVolume {
  name: string;
  config: IncusConfigMap;
  createdAt: string;
  files?: Map<string, FakeFile>;
  snapshots?: FakeVolumeSnapshot[];
}

/** What runs inside every instance of the fake, as far as a test needs it. */
export interface FakeGuest {
  /** The instance reached Running: the environment its main process booted
   * with, or undefined while it waits for something. */
  boot(
    instance: FakeInstance,
    environment: Record<string, string>,
  ): Record<string, string> | undefined;
  /** A file was written into the instance. */
  written(instance: FakeInstance, path: string, content: string): void;
}

/** A guest whose main process boots at once with the instance's environment,
 * and that no file sets off. */
const PLAIN_GUEST: FakeGuest = {
  boot: (_instance, environment) => environment,
  written: () => undefined,
};

/** The instance's `environment.*` keys, without the prefix. */
export function instanceEnvironment(
  instance: FakeInstance,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(instance.config)) {
    if (key.startsWith('environment.'))
      env[key.slice('environment.'.length)] = value;
  }
  return env;
}

interface FakeOperation {
  id: string;
  statusCode: number;
  err: string;
  settled: Promise<void>;
  metadata: unknown;
  /** Whether a DELETE may cancel it (an exec's may not). */
  mayCancel: boolean;
}

interface PendingSocketExec {
  call: FakeExecCall;
  secrets: Record<string, string>;
  sockets: Map<string, FakeSocket>;
  operation: FakeOperation;
  stdin: StdinQueue;
  signals: number[];
  killed: AbortController;
  started: boolean;
  finish: (code: number) => void;
}

interface FakeSocket {
  send(data: string | Uint8Array): unknown;
  close(): void;
}

/** stdin bytes as they arrive, and their end. */
class StdinQueue {
  private readonly chunks: Uint8Array[] = [];
  private ended = false;
  private wake: (() => void) | undefined;

  push(chunk: Uint8Array): void {
    this.chunks.push(chunk);
    this.wake?.();
  }

  end(): void {
    this.ended = true;
    this.wake?.();
  }

  async *iterate(): AsyncIterable<Uint8Array> {
    let next = 0;
    for (;;) {
      while (next < this.chunks.length) {
        const chunk = this.chunks[next];
        next += 1;
        if (chunk !== undefined) yield chunk;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
  }

  async all(): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];
    for await (const chunk of this.iterate()) parts.push(chunk);
    return Buffer.concat(parts);
  }
}

class FakeFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface FakeIncusOptions {
  project?: string;
  /** Names the project, profile, network and pool the fake serves. */
  profile?: string;
  network?: string;
  pool?: string;
  poolDriver?: string;
  image?: string;
}

export interface FailureRule {
  /** `METHOD /path` with `*` standing for one path segment. */
  match: string;
  status: number;
  message: string;
  /** How many times it applies (default once). */
  times?: number;
}

const DEFAULT_EXTENSIONS = [
  'storage_shifted',
  'instance_oci',
  'instance_oci_entrypoint',
  'oci_network_config',
  'instance_create_start',
  'container_disk_tmpfs',
  'storage_initial_owner',
  'storage_volumes_created_at',
];

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function syncOk(metadata: unknown, headers: Record<string, string> = {}) {
  return jsonResponse(
    200,
    { type: 'sync', status: 'Success', status_code: 200, metadata },
    headers,
  );
}

function errorResponse(status: number, message: string) {
  return jsonResponse(status, {
    type: 'error',
    error: message,
    error_code: status,
    metadata: {},
  });
}

/** A request body as an object, or an empty one. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function requiredText(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value === '') {
    throw new FakeFailure(400, `Missing ${key}`);
  }
  return value;
}

function parseCreateBody(raw: unknown): CreateBody {
  const body = asRecord(raw);
  const source = asRecord(body.source);
  return {
    name: requiredText(body, 'name'),
    ephemeral: body.ephemeral === true,
    profiles: Array.isArray(body.profiles)
      ? body.profiles.filter((item): item is string => typeof item === 'string')
      : [],
    config: stringMap(body.config),
    devices: devicesOf(body.devices),
    source: { type: 'image', alias: requiredText(source, 'alias') },
    start: body.start === true,
  };
}

function parseStateBody(raw: unknown): StateBody {
  const body = asRecord(raw);
  const action = body.action;
  if (
    action !== 'start' &&
    action !== 'stop' &&
    action !== 'freeze' &&
    action !== 'unfreeze'
  ) {
    throw new FakeFailure(400, `Unknown state action ${String(action)}`);
  }
  return {
    action,
    force: body.force === true,
    timeout: typeof body.timeout === 'number' ? body.timeout : -1,
  };
}

function copyFiles(files: Map<string, FakeFile>): Map<string, FakeFile> {
  return new Map(
    [...files].map(([path, file]) => [
      path,
      {
        ...file,
        ...(file.bytes === undefined ? {} : { bytes: file.bytes.slice() }),
      },
    ]),
  );
}

const STATUS_CODE: Record<FakeInstance['status'], number> = {
  Running: INCUS_STATUS.running,
  Frozen: INCUS_STATUS.frozen,
  Stopped: INCUS_STATUS.stopped,
  Starting: INCUS_STATUS.starting,
  Error: INCUS_STATUS.error,
};

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${escaped}$`);
}

export class FakeIncus {
  readonly requests: RecordedRequest[] = [];
  readonly instances = new Map<string, FakeInstance>();
  readonly volumes = new Map<string, FakeVolume>();
  /** Image alias → fingerprint. */
  readonly aliases = new Map<string, string>();
  readonly options: Required<FakeIncusOptions>;

  /** What the server says it is. */
  auth = 'trusted';
  kernelFeatures: Record<string, string> = { idmapped_mounts: 'true' };
  extensions: string[] = [...DEFAULT_EXTENSIONS];
  /** The architectures the server runs (`environment.architectures`). */
  architectures: string[] = ['x86_64', 'i686'];
  /** Whether the server is a cluster member. */
  clustered = false;
  /** The storage drivers and their versions the server reports. */
  storageDrivers: Array<{ name: string; version: string; remote: boolean }> = [
    { name: 'zfs', version: '2.4.1-1ubuntu5.1', remote: false },
    { name: 'btrfs', version: '6.17.1', remote: false },
    { name: 'dir', version: '1', remote: false },
  ];
  /** What an image holds, by fingerprint: a new instance's files start as
   * a copy (the file API reads them, running or not). */
  readonly imageFiles = new Map<string, Map<string, FakeFile>>();
  projectConfig: IncusConfigMap = {
    'features.images': 'true',
    'features.profiles': 'true',
    'features.storage.volumes': 'true',
    restricted: 'true',
    'restricted.containers.nesting': 'allow',
    'restricted.containers.interception': 'allow',
  };
  profileConfig: IncusConfigMap = {};
  profileDevices: IncusDevices;
  networkConfig: IncusConfigMap = { 'security.acls': 'sandbox-egress' };
  networkManaged = true;
  /** Hand a new instance an address (the profile's NIC got its lease). */
  assignAddresses = true;
  /** Pause an instance's ephemeral deletion after a stop, in ms. */
  deleteDelayMs = 0;
  /** Run when an instance reaches Running. */
  onStarted: ((instance: FakeInstance) => void) | undefined;
  /** Run once a delete has taken an instance away, before the client hears. */
  onDeleted: ((instance: FakeInstance) => void) | undefined;
  /** Image pulls fail with this message when set. */
  pullFailure: string | undefined;
  /** What runs inside every instance. */
  guest: FakeGuest = PLAIN_GUEST;
  /** What an exec does; by default it exits 0 and writes nothing. */
  exec: FakeExecHandler = () => 0;
  /** What the pool reports about its room. */
  poolResources = {
    space: { used: 1024 ** 3, total: 100 * 1024 ** 3 },
    inodes: { used: 1000, total: 1_000_000 },
  };
  /** Image fingerprints the project holds. */
  readonly images = new Set<string>();
  /** The execs the fake ran, in order. */
  readonly execs: FakeExecCall[] = [];

  private readonly rules: Array<FailureRule & { left: number }> = [];
  private readonly holds: Array<{ pattern: RegExp; gate: Promise<void> }> = [];
  private readonly operations = new Map<string, FakeOperation>();
  private nextAddress = 10;
  private tick = 0;
  private nextOperation = 1;
  private readonly socketExecs = new Map<string, PendingSocketExec>();
  private socketServer: ReturnType<typeof Bun.serve> | undefined;

  constructor(options: FakeIncusOptions = {}) {
    this.options = {
      project: options.project ?? 'sandbox-pr',
      profile: options.profile ?? 'sandbox',
      network: options.network ?? 'sbx0',
      pool: options.pool ?? 'tank',
      poolDriver: options.poolDriver ?? 'zfs',
      image: options.image ?? 'tale-sandbox-runtime',
    };
    this.profileDevices = {
      root: { type: 'disk', path: '/', pool: this.options.pool, size: '30GiB' },
      eth0: {
        type: 'nic',
        network: this.options.network,
        name: 'eth0',
        'security.port_isolation': 'true',
        'security.acls': 'sandbox-egress',
      },
    };
    this.aliases.set(this.options.image, 'f'.repeat(64));
    this.images.add('f'.repeat(64));
  }

  /** A client wired to this fake; it answers to no ambient signal unless the
   * test hands it one. */
  client(
    overrides: {
      requestTimeoutMs?: number;
      signal?: () => AbortSignal | undefined;
    } = {},
  ): IncusClient {
    return new IncusClient({
      endpoint: 'https://incus.fake:8443',
      project: this.options.project,
      tls: { ca: 'ca', cert: 'cert', key: 'key' },
      signal: () => undefined,
      fetch: this.fetch,
      webSocket: (url) => {
        const target = new URL(url);
        return new WebSocket(
          `ws://127.0.0.1:${this.websocketPort()}${target.pathname}${target.search}`,
        );
      },
      sleep: async () => undefined,
      ...overrides,
    });
  }

  // ---- test controls -----------------------------------------------------

  /** Fail the next request(s) matching `METHOD /path` (`*` = one segment). */
  fail(rule: FailureRule): void {
    this.rules.push({ ...rule, left: rule.times ?? 1 });
  }

  /** Hold the answer to matching requests until the returned function runs. */
  hold(match: string): () => void {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.holds.push({ pattern: globToRegExp(match), gate });
    return release;
  }

  /** Requests matching `METHOD /path`, as recorded. */
  seen(match: string): RecordedRequest[] {
    const pattern = globToRegExp(match);
    return this.requests.filter((request) =>
      pattern.test(`${request.method} ${request.path}`),
    );
  }

  addImage(alias: string, fingerprint = 'a'.repeat(64)): void {
    this.aliases.set(alias, fingerprint);
    this.images.add(fingerprint);
  }

  /** Stops the websocket server, if an exec session started it. */
  close(): void {
    void this.socketServer?.stop(true);
    this.socketServer = undefined;
  }

  /** An instance as the backend would find it after a spawner restart. */
  seedInstance(
    name: string,
    config: IncusConfigMap,
    options: Partial<
      Pick<FakeInstance, 'status' | 'devices' | 'ephemeral'>
    > = {},
  ): FakeInstance {
    const instance = this.newInstance({
      name,
      config,
      devices: options.devices ?? {},
      ephemeral: options.ephemeral ?? true,
    });
    instance.status = options.status ?? 'Running';
    if (instance.status === 'Running') this.boot(instance);
    this.instances.set(name, instance);
    return instance;
  }

  seedVolume(name: string, config: IncusConfigMap): FakeVolume {
    const volume = { name, config, createdAt: this.timestamp() };
    this.volumes.set(name, volume);
    return volume;
  }

  instanceByAddress(address: string): FakeInstance | undefined {
    return [...this.instances.values()].find((i) => i.address === address);
  }

  /** The names of the instances that exist. */
  names(): string[] {
    return [...this.instances.keys()].sort();
  }

  // ---- the fetch ---------------------------------------------------------

  readonly fetch: IncusFetch = async (url, init) => {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .split('/')
      .filter((part) => part !== '')
      .map((part) => decodeURIComponent(part));
    const query = Object.fromEntries(parsed.searchParams);
    // The client sends JSON as text and a file's bytes raw.
    let body: unknown;
    let raw: Uint8Array | undefined;
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    else if (init.body instanceof Uint8Array) {
      raw = init.body;
      body = new TextDecoder().decode(init.body);
    }
    const request: RecordedRequest = {
      method: init.method,
      path: parsed.pathname,
      query,
      headers: init.headers,
      body,
      ...(raw === undefined ? {} : { raw }),
    };
    this.requests.push(request);
    const signature = `${init.method} ${parsed.pathname}`;
    for (const held of this.holds) {
      if (held.pattern.test(signature)) await held.gate;
    }
    init.signal.throwIfAborted();
    const rule = this.rules.find(
      (candidate) =>
        candidate.left > 0 && globToRegExp(candidate.match).test(signature),
    );
    if (rule !== undefined) {
      rule.left -= 1;
      return errorResponse(rule.status, rule.message);
    }
    try {
      return await this.route(init.method, segments, request);
    } catch (error) {
      if (error instanceof FakeFailure)
        return errorResponse(error.status, error.message);
      throw error;
    }
  };

  private async route(
    method: string,
    segments: string[],
    request: RecordedRequest,
  ): Promise<Response> {
    const [version, area, a, b, c, d] = segments;
    if (version !== '1.0') throw new FakeFailure(404, 'not found');
    if (area === undefined) {
      return syncOk({
        api_extensions: this.extensions,
        auth: this.auth,
        environment: {
          server_name: 'fake-node',
          server_version: '7.5.1',
          kernel_features: this.kernelFeatures,
          architectures: this.architectures,
          server_clustered: this.clustered,
          storage_supported_drivers: this.storageDrivers,
        },
      });
    }
    if (this.auth !== 'trusted') throw new FakeFailure(403, 'not authorized');
    const { project } = request.query;
    switch (area) {
      case 'projects':
        if (b === 'state') return this.getProjectState(a);
        return this.getProject(a);
      case 'profiles':
        this.requireProject(project);
        return this.getProfile(a);
      case 'networks':
        this.requireProject(project);
        return this.getNetwork(a);
      case 'storage-pools':
        if (b === undefined) return this.getPool(a);
        if (b === 'resources') {
          if (a !== this.options.pool)
            throw new FakeFailure(404, 'Storage pool not found');
          return syncOk(this.poolResources);
        }
        if (b === 'volumes' && c === 'custom') {
          this.requireProject(project);
          const sub = segments[6];
          const snapshot = segments[7];
          if (sub === 'snapshots') {
            return this.snapshotRoute(method, a, d, snapshot, request);
          }
          if (sub === 'files') {
            const volume = this.volumes.get(d ?? '');
            if (volume === undefined)
              throw new FakeFailure(404, 'Storage volume not found');
            volume.files ??= new Map();
            return this.fileRoute(method, volume.files, request, undefined);
          }
          return this.volumeRoute(method, a, d, request);
        }
        break;
      case 'instances':
        this.requireProject(project);
        if (b === 'logs') return this.logRoute(method, a, segments.slice(4));
        return this.instanceRoute(method, a, b, request);
      case 'operations':
        if (b === 'wait') return this.waitOperation(a, request);
        if (b === undefined && method === 'DELETE')
          return this.cancelOperation(a);
        break;
      case 'images':
        this.requireProject(project);
        if (a === 'aliases') return this.aliasRoute(method, b, request);
        if (a === undefined && method === 'POST')
          return this.pullImage(request);
        if (a !== undefined && b === undefined && method === 'DELETE')
          return this.deleteImage(a);
        break;
      default:
        break;
    }
    throw new FakeFailure(
      404,
      `not implemented in the fake: ${method} ${request.path}`,
    );
  }

  private requireProject(project: string | undefined): void {
    if (project !== this.options.project) {
      throw new FakeFailure(
        403,
        `User does not have permission for project "${project ?? 'default'}"`,
      );
    }
  }

  // ---- what the server holds ---------------------------------------------

  private getProject(name: string | undefined): Response {
    if (name !== this.options.project) {
      throw new FakeFailure(
        403,
        `User does not have permission for project "${name}"`,
      );
    }
    return syncOk({ name, config: this.projectConfig });
  }

  private getProfile(name: string | undefined): Response {
    if (name !== this.options.profile)
      throw new FakeFailure(404, 'Profile not found');
    return syncOk({
      name,
      config: this.profileConfig,
      devices: this.profileDevices,
    });
  }

  private getNetwork(name: string | undefined): Response {
    if (name !== this.options.network)
      throw new FakeFailure(404, 'Network not found');
    return syncOk({
      name,
      type: 'bridge',
      managed: this.networkManaged,
      config: this.networkConfig,
    });
  }

  private getPool(name: string | undefined): Response {
    if (name !== this.options.pool)
      throw new FakeFailure(404, 'Storage pool not found');
    return syncOk({ name, driver: this.options.poolDriver });
  }

  private aliasRoute(
    method: string,
    alias: string | undefined,
    request: RecordedRequest,
  ): Response {
    if (alias === undefined) {
      if (method === 'GET') {
        return syncOk(
          [...this.aliases].map(([name, target]) => ({ name, target })),
        );
      }
      if (method === 'POST') {
        const body = asRecord(request.body);
        const name = requiredText(body, 'name');
        const target = requiredText(body, 'target');
        if (!this.images.has(target))
          throw new FakeFailure(404, 'Image not found');
        if (this.aliases.has(name))
          throw new FakeFailure(409, 'Alias already exists');
        this.aliases.set(name, target);
        return syncOk({});
      }
    } else {
      const target = this.aliases.get(alias);
      if (target === undefined)
        throw new FakeFailure(404, 'Image alias not found');
      if (method === 'GET') return syncOk({ name: alias, target });
      if (method === 'DELETE') {
        this.aliases.delete(alias);
        return syncOk({});
      }
    }
    throw new FakeFailure(
      404,
      `not implemented in the fake: ${method} ${request.path}`,
    );
  }

  private deleteImage(fingerprint: string): Response {
    if (!this.images.has(fingerprint))
      throw new FakeFailure(404, 'Image not found');
    return this.startOperation(async () => {
      this.images.delete(fingerprint);
      for (const [name, target] of this.aliases) {
        if (target === fingerprint) this.aliases.delete(name);
      }
    });
  }

  private getProjectState(name: string | undefined): Response {
    if (name !== this.options.project) {
      throw new FakeFailure(
        403,
        `User does not have permission for project "${name}"`,
      );
    }
    const limit = (key: string) => {
      const value = this.projectConfig[key];
      if (value === undefined || value === '') return -1;
      return key === 'limits.disk'
        ? (incusSizeBytes(value) ?? -1)
        : Number(value);
    };
    const disk = [...this.volumes.values()].reduce(
      (sum, volume) => sum + (incusSizeBytes(volume.config.size ?? '') ?? 0),
      0,
    );
    return syncOk({
      resources: {
        instances: {
          limit: limit('limits.instances'),
          usage: this.instances.size,
        },
        disk: { limit: limit('limits.disk'), usage: disk },
      },
    });
  }

  private pullImage(request: RecordedRequest): Response {
    const body = asRecord(request.body);
    const names = (Array.isArray(body.aliases) ? body.aliases : [])
      .map((alias) => asRecord(alias).name)
      .filter((name): name is string => typeof name === 'string');
    return this.startOperation(async () => {
      if (this.pullFailure !== undefined)
        throw new FakeFailure(500, this.pullFailure);
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(body.source))
        .digest('hex');
      this.images.add(fingerprint);
      for (const name of names) this.aliases.set(name, fingerprint);
    });
  }

  // ---- operations ----------------------------------------------------------

  private startOperation(
    work: (operation: FakeOperation) => Promise<void>,
    options: {
      metadata?: unknown;
      mayCancel?: boolean;
      created?: (operation: FakeOperation) => void;
    } = {},
  ): Response {
    const id = `op-${this.nextOperation++}`;
    const operation: FakeOperation = {
      id,
      statusCode: INCUS_STATUS.running,
      err: '',
      settled: Promise.resolve(),
      metadata: options.metadata ?? null,
      mayCancel: options.mayCancel ?? false,
    };
    operation.settled = (async () => {
      try {
        await work(operation);
        operation.statusCode = INCUS_STATUS.success;
      } catch (error) {
        operation.statusCode = INCUS_STATUS.failure;
        operation.err = error instanceof Error ? error.message : String(error);
      }
    })();
    this.operations.set(id, operation);
    options.created?.(operation);
    return jsonResponse(
      202,
      {
        type: 'async',
        status: 'Operation created',
        status_code: 100,
        operation: `/1.0/operations/${id}`,
        metadata: this.renderOperation(operation, INCUS_STATUS.running),
      },
      { location: `/1.0/operations/${id}` },
    );
  }

  private renderOperation(operation: FakeOperation, statusCode: number) {
    return {
      id: operation.id,
      status:
        statusCode === INCUS_STATUS.success
          ? 'Success'
          : statusCode === INCUS_STATUS.running
            ? 'Running'
            : 'Failure',
      status_code: statusCode,
      err: statusCode === INCUS_STATUS.running ? '' : operation.err,
      may_cancel: operation.mayCancel,
      metadata: operation.metadata,
    };
  }

  private cancelOperation(id: string | undefined): Response {
    const operation = id === undefined ? undefined : this.operations.get(id);
    if (operation === undefined)
      throw new FakeFailure(404, 'Operation not found');
    // An exec cannot be cancelled; nothing else the fake runs can either.
    throw new FakeFailure(400, "This operation can't be cancelled");
  }

  private async waitOperation(
    id: string | undefined,
    request: RecordedRequest,
  ): Promise<Response> {
    const operation = id === undefined ? undefined : this.operations.get(id);
    if (operation === undefined)
      throw new FakeFailure(404, 'Operation not found');
    const timeoutMs = Number(request.query.timeout ?? '-1') * 1000;
    if (timeoutMs >= 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        operation.settled,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
    } else {
      await operation.settled;
    }
    return syncOk(this.renderOperation(operation, operation.statusCode));
  }

  // ---- volumes -----------------------------------------------------------------

  private volumeUsers(name: string): FakeInstance[] {
    return [...this.instances.values()].filter((instance) =>
      Object.values(instance.devices).some(
        (device) =>
          device.type === 'disk' &&
          device.pool === this.options.pool &&
          device.source === name,
      ),
    );
  }

  private volumeUsedBy(name: string): string[] {
    return this.volumeUsers(name).map(
      (instance) =>
        `/1.0/instances/${instance.name}?project=${this.options.project}`,
    );
  }

  private renderVolume(volume: FakeVolume) {
    return {
      name: volume.name,
      type: 'custom',
      content_type: 'filesystem',
      config: volume.config,
      created_at: volume.createdAt,
      used_by: this.volumeUsedBy(volume.name),
    };
  }

  private volumeRoute(
    method: string,
    pool: string | undefined,
    name: string | undefined,
    request: RecordedRequest,
  ): Response {
    if (pool !== this.options.pool)
      throw new FakeFailure(404, 'Storage pool not found');
    if (name === undefined) {
      if (method === 'GET') {
        return syncOk(
          [...this.volumes.values()].map((volume) => this.renderVolume(volume)),
        );
      }
      if (method === 'POST') {
        const body = asRecord(request.body);
        const volumeName = requiredText(body, 'name');
        const diskLimited = Object.keys(this.projectConfig).some(
          (key) =>
            (key === 'limits.disk' || key.startsWith('limits.disk.pool.')) &&
            this.projectConfig[key] !== '',
        );
        if (diskLimited && stringMap(body.config).size === undefined) {
          throw new FakeFailure(
            400,
            `Custom volume "${volumeName}" in project "${this.options.project}" has no "size" config set`,
          );
        }
        if (this.volumes.has(volumeName)) {
          throw new FakeFailure(
            409,
            `Storage volume "${volumeName}" already exists`,
          );
        }
        const source = asRecord(body.source);
        if (source.type === 'copy') {
          const sourceName = typeof source.name === 'string' ? source.name : '';
          const [from, snapshotName] = sourceName.split('/');
          const origin = this.volumes.get(from ?? '');
          const snapshot = origin?.snapshots?.find(
            (candidate) => candidate.name === snapshotName,
          );
          if (origin === undefined || snapshot === undefined) {
            throw new FakeFailure(
              404,
              `Storage volume snapshot "${sourceName}" not found`,
            );
          }
          return this.startOperation(async () => {
            this.volumes.set(volumeName, {
              name: volumeName,
              config:
                body.config === undefined
                  ? { ...snapshot.config }
                  : stringMap(body.config),
              createdAt: this.timestamp(),
              files: copyFiles(snapshot.files),
              snapshots: [],
            });
          });
        }
        this.volumes.set(volumeName, {
          name: volumeName,
          config: stringMap(body.config),
          createdAt: this.timestamp(),
        });
        return syncOk(null);
      }
    } else {
      const volume = this.volumes.get(name);
      if (method === 'GET') {
        if (volume === undefined)
          throw new FakeFailure(404, 'Storage volume not found');
        return syncOk(this.renderVolume(volume));
      }
      if (method === 'DELETE') {
        if (volume === undefined)
          throw new FakeFailure(404, 'Storage volume not found');
        if (this.volumeUsedBy(name).length > 0) {
          throw new FakeFailure(
            400,
            `Storage volume "${name}" is in use by an instance`,
          );
        }
        this.volumes.delete(name);
        return syncOk(null);
      }
      if (method === 'POST') {
        if (volume === undefined)
          throw new FakeFailure(404, 'Storage volume not found');
        const to = requiredText(asRecord(request.body), 'name');
        if (this.volumes.has(to)) {
          throw new FakeFailure(409, `Storage volume "${to}" already exists`);
        }
        const users = this.volumeUsers(name);
        if (users.some((instance) => instance.status !== 'Stopped')) {
          throw new FakeFailure(
            400,
            'Volume is still in use by running instances',
          );
        }
        return this.startOperation(async () => {
          // Incus rewrites the device source of a stopped user (slowly).
          for (const instance of users) {
            for (const device of Object.values(instance.devices)) {
              if (device.type === 'disk' && device.source === name)
                device.source = to;
            }
          }
          this.volumes.delete(name);
          volume.name = to;
          this.volumes.set(to, volume);
        });
      }
    }
    throw new FakeFailure(
      404,
      `not implemented in the fake: ${method} ${request.path}`,
    );
  }

  private snapshotRoute(
    method: string,
    pool: string | undefined,
    name: string | undefined,
    snapshotName: string | undefined,
    request: RecordedRequest,
  ): Response {
    if (pool !== this.options.pool)
      throw new FakeFailure(404, 'Storage pool not found');
    const volume = this.volumes.get(name ?? '');
    if (volume === undefined)
      throw new FakeFailure(404, 'Storage volume not found');
    const snapshots = (volume.snapshots ??= []);
    const render = (snapshot: FakeVolumeSnapshot) => ({
      name: snapshot.name,
      config: snapshot.config,
      created_at: snapshot.createdAt,
      expires_at: snapshot.expiresAt,
    });
    if (snapshotName === undefined) {
      if (method === 'GET') return syncOk(snapshots.map(render));
      if (method === 'POST') {
        const body = asRecord(request.body);
        const snapshot = requiredText(body, 'name');
        if (snapshots.some((candidate) => candidate.name === snapshot)) {
          throw new FakeFailure(409, `Snapshot "${snapshot}" already exists`);
        }
        return this.startOperation(async () => {
          snapshots.push({
            name: snapshot,
            createdAt: this.timestamp(),
            expiresAt:
              typeof body.expires_at === 'string'
                ? body.expires_at
                : '0001-01-01T00:00:00Z',
            config: { ...volume.config },
            files: copyFiles(volume.files ?? new Map()),
          });
        });
      }
    } else {
      const index = snapshots.findIndex(
        (candidate) => candidate.name === snapshotName,
      );
      const snapshot = snapshots[index];
      if (snapshot === undefined)
        throw new FakeFailure(404, 'Storage volume snapshot not found');
      if (method === 'GET') return syncOk(render(snapshot));
      if (method === 'DELETE') {
        return this.startOperation(async () => {
          snapshots.splice(snapshots.indexOf(snapshot), 1);
        });
      }
    }
    throw new FakeFailure(
      404,
      `not implemented in the fake: ${method} ${request.path}`,
    );
  }

  /** The file API, for an instance's files or a volume's. */
  private fileRoute(
    method: string,
    files: Map<string, FakeFile>,
    request: RecordedRequest,
    instance: FakeInstance | undefined,
  ): Response {
    const path = request.query.path;
    if (path === undefined) throw new FakeFailure(400, 'Missing path argument');
    if (path.split('/').includes('..')) throw new FakeFailure(404, 'not found');
    const entry = files.get(path);
    const children = [...files.keys()]
      .filter((key) => key.startsWith(path === '/' ? '/' : `${path}/`))
      .map((key) => key.slice(path === '/' ? 1 : path.length + 1).split('/')[0])
      .filter((child): child is string => child !== undefined && child !== '');
    const isDirectory =
      entry?.type === 'directory' ||
      (entry === undefined && (path === '/' || children.length > 0));
    const headers = (file: FakeFile | undefined, type: string) => ({
      'x-incus-type': type,
      'x-incus-uid': String(file?.uid ?? 0),
      'x-incus-gid': String(file?.gid ?? 0),
      'x-incus-mode':
        file?.mode === undefined || file.mode === '' ? '0644' : file.mode,
    });
    if (method === 'HEAD' || method === 'GET') {
      if (entry === undefined && !isDirectory)
        throw new FakeFailure(404, 'not found');
      if (isDirectory) {
        if (method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: headers(entry, 'directory'),
          });
        }
        return jsonResponse(
          200,
          {
            type: 'sync',
            status: 'Success',
            status_code: 200,
            metadata: [...new Set(children)].sort(),
          },
          headers(entry, 'directory'),
        );
      }
      if (entry === undefined) throw new FakeFailure(404, 'not found');
      const file = entry;
      const type = file.type ?? 'file';
      return new Response(
        method === 'HEAD' ? null : (file.bytes ?? file.content),
        {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            ...headers(file, type),
          },
        },
      );
    }
    if (method === 'POST') {
      const type = request.headers['x-incus-type'] ?? 'file';
      const owner = {
        mode: request.headers['x-incus-mode'] ?? '',
        ...(request.headers['x-incus-uid'] === undefined
          ? {}
          : { uid: Number(request.headers['x-incus-uid']) }),
        ...(request.headers['x-incus-gid'] === undefined
          ? {}
          : { gid: Number(request.headers['x-incus-gid']) }),
      };
      if (type === 'directory') {
        files.set(path, { content: '', type: 'directory', ...owner });
        return syncOk(null);
      }
      // Incus writes an empty file for a body sent with a form content type.
      const raw =
        request.headers['content-type'] === 'application/octet-stream'
          ? (request.raw ?? new Uint8Array())
          : new Uint8Array();
      const bytes =
        request.headers['x-incus-write'] === 'append' && entry !== undefined
          ? Buffer.concat([
              entry.bytes ?? new TextEncoder().encode(entry.content),
              raw,
            ])
          : raw;
      const content = new TextDecoder().decode(bytes);
      files.set(path, {
        ...entry,
        content,
        bytes,
        type: 'file',
        ...owner,
        mode: owner.mode === '' ? (entry?.mode ?? '') : owner.mode,
      });
      if (instance !== undefined) this.guest.written(instance, path, content);
      return syncOk(null);
    }
    if (method === 'DELETE') {
      if (entry === undefined) throw new FakeFailure(404, 'not found');
      files.delete(path);
      return syncOk(null);
    }
    throw new FakeFailure(
      404,
      `not implemented in the fake: ${method} ${request.path}`,
    );
  }

  private logRoute(
    method: string,
    name: string | undefined,
    rest: string[],
  ): Response {
    const instance = this.require(name);
    const file = rest.join('/');
    if (file === '' && method === 'GET') {
      return syncOk(
        [...instance.logs.keys()]
          .filter((key) => !key.includes('/'))
          .map((key) => `/1.0/instances/${instance.name}/logs/${key}`),
      );
    }
    const content = instance.logs.get(file);
    if (content === undefined) throw new FakeFailure(404, 'not found');
    if (method === 'GET') return new Response(content, { status: 200 });
    if (method === 'DELETE') {
      instance.logs.delete(file);
      return syncOk(null);
    }
    throw new FakeFailure(
      404,
      `not implemented in the fake: ${method} logs/${file}`,
    );
  }

  // ---- instances ---------------------------------------------------------------

  private timestamp(): string {
    this.tick += 1;
    return new Date(
      Date.UTC(2026, 9, 11, 12, 0, 0) + this.tick * 1000,
    ).toISOString();
  }

  private newInstance(input: {
    name: string;
    config: IncusConfigMap;
    devices: IncusDevices;
    ephemeral: boolean;
    profiles?: string[];
  }): FakeInstance {
    return {
      name: input.name,
      status: 'Stopped',
      ephemeral: input.ephemeral,
      config: { ...input.config },
      devices: structuredClone(input.devices),
      profiles: input.profiles ?? [this.options.profile],
      createdAt: this.timestamp(),
      address: undefined,
      files: new Map(),
      consoleLog: '',
      logs: new Map([['lxc.log', new TextEncoder().encode('lxc log\n')]]),
      bootEnv: undefined,
      version: 1,
      startedAt: '',
    };
  }

  private render(instance: FakeInstance) {
    return {
      name: instance.name,
      status: instance.status,
      status_code: STATUS_CODE[instance.status],
      ephemeral: instance.ephemeral,
      config: instance.config,
      devices: instance.devices,
      profiles: instance.profiles,
      created_at: instance.createdAt,
    };
  }

  private renderFull(instance: FakeInstance) {
    const running = instance.status === 'Running';
    return {
      ...this.render(instance),
      state: running
        ? {
            status: 'Running',
            status_code: INCUS_STATUS.running,
            started_at: instance.startedAt,
            network: {
              lo: {
                addresses: [
                  { family: 'inet', address: '127.0.0.1', scope: 'local' },
                ],
              },
              ...(instance.address === undefined
                ? {}
                : {
                    eth0: {
                      addresses: [
                        {
                          family: 'inet',
                          address: instance.address,
                          scope: 'global',
                        },
                      ],
                    },
                  }),
            },
          }
        : null,
    };
  }

  private etag(instance: FakeInstance): string {
    return `"v${instance.version}-${createHash('sha256')
      .update(JSON.stringify([instance.config, instance.devices]))
      .digest('hex')
      .slice(0, 8)}"`;
  }

  private require(name: string | undefined): FakeInstance {
    const instance = name === undefined ? undefined : this.instances.get(name);
    if (instance === undefined)
      throw new FakeFailure(404, 'Instance not found');
    return instance;
  }

  private instanceRoute(
    method: string,
    name: string | undefined,
    sub: string | undefined,
    request: RecordedRequest,
  ): Response | Promise<Response> {
    if (name === undefined) {
      if (method === 'GET') {
        return syncOk(
          [...this.instances.values()].map((instance) => this.render(instance)),
        );
      }
      if (method === 'POST')
        return this.createInstance(parseCreateBody(request.body));
    } else if (sub === undefined) {
      if (method === 'GET') {
        const instance = this.require(name);
        const full = request.query.recursion === '1';
        return syncOk(
          full ? this.renderFull(instance) : this.render(instance),
          {
            etag: this.etag(instance),
          },
        );
      }
      if (method === 'PATCH') return this.patchInstance(name, request);
      if (method === 'PUT') return this.putInstance(name, request);
      if (method === 'DELETE') return this.deleteInstance(name);
    } else if (sub === 'state' && method === 'PUT') {
      return this.changeState(name, parseStateBody(request.body));
    } else if (sub === 'state' && method === 'GET') {
      const instance = this.require(name);
      const full = this.renderFull(instance);
      return syncOk(
        full.state ?? {
          status: instance.status,
          status_code: STATUS_CODE[instance.status],
          started_at: instance.startedAt,
          network: {},
        },
      );
    } else if (sub === 'files') {
      const instance = this.require(name);
      return this.fileRoute(method, instance.files, request, instance);
    } else if (sub === 'exec' && method === 'POST') {
      return this.startExec(this.require(name), request);
    } else if (sub === 'console' && method === 'GET') {
      const instance = this.require(name);
      const log = instance.consoleLog;
      // A read of a running console consumes what it returns.
      if (instance.status === 'Running') instance.consoleLog = '';
      return new Response(log);
    }
    throw new FakeFailure(
      404,
      `not implemented in the fake: ${method} ${request.path}`,
    );
  }

  /** What a restricted project refuses, as Incus's permission checks word it. */
  private checkRestrictions(
    name: string,
    config: IncusConfigMap,
    devices: IncusDevices,
  ): void {
    if (this.projectConfig.restricted !== 'true') return;
    const lowLevel = (key: string) =>
      key.startsWith('raw.') ||
      key === 'limits.memory.swap' ||
      key === 'limits.memory.oom_priority' ||
      key === 'linux.kernel_modules' ||
      key.startsWith('security.bpffs');
    for (const [key, value] of Object.entries(config)) {
      if (
        lowLevel(key) &&
        this.projectConfig['restricted.containers.lowlevel'] !== 'allow'
      ) {
        throw new FakeFailure(
          400,
          `Use of low-level "${key}" on instance "${name}" of project "${this.options.project}" is forbidden`,
        );
      }
      if (key === 'security.privileged' && value === 'true') {
        throw new FakeFailure(400, 'Privileged containers are forbidden');
      }
      if (
        key === 'security.nesting' &&
        value === 'true' &&
        this.projectConfig['restricted.containers.nesting'] !== 'allow'
      ) {
        throw new FakeFailure(400, 'Container nesting is forbidden');
      }
      if (
        key.startsWith('security.syscalls.intercept.') &&
        value !== '' &&
        value !== 'false' &&
        this.projectConfig['restricted.containers.interception'] !== 'allow'
      ) {
        throw new FakeFailure(
          400,
          'Container syscall interception is forbidden',
        );
      }
    }
    for (const [deviceName, device] of Object.entries(devices)) {
      if (device.type === 'disk') {
        if (device.path === '/' || device.pool !== undefined) continue;
        const mode = this.projectConfig['restricted.devices.disk'] ?? 'managed';
        const paths = this.projectConfig['restricted.devices.disk.paths'] ?? '';
        const allowed =
          mode === 'allow' &&
          (paths === '' ||
            paths
              .split(',')
              .some((prefix) => `${device.source}/`.startsWith(`${prefix}/`)));
        if (!allowed) {
          throw new FakeFailure(
            400,
            `Disk device "${deviceName}": attaching disks not backed by a pool is forbidden`,
          );
        }
      } else if (device.type === 'nic') {
        if (device.network === undefined) {
          throw new FakeFailure(
            400,
            `NIC device "${deviceName}": only managed networks are allowed`,
          );
        }
      } else {
        throw new FakeFailure(
          400,
          `Device "${deviceName}": devices of type ${device.type} are forbidden`,
        );
      }
    }
  }

  private createInstance(body: CreateBody): Response {
    if (!/^[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(body.name)) {
      throw new FakeFailure(400, `Invalid instance name "${body.name}"`);
    }
    if (this.instances.has(body.name)) {
      // Incus's own pre-check is a plain error, which surfaces as a 500.
      throw new FakeFailure(500, `Instance "${body.name}" already exists`);
    }
    if (!this.aliases.has(body.source.alias))
      throw new FakeFailure(404, 'Image not found');
    if (!body.profiles.includes(this.options.profile))
      throw new FakeFailure(404, 'Profile not found');
    this.checkRestrictions(body.name, body.config, body.devices);
    this.checkProjectLimits(body);
    this.checkVolumes(body.devices);
    const instance = this.newInstance({
      name: body.name,
      config: body.config,
      devices: body.devices,
      ephemeral: body.ephemeral,
      profiles: body.profiles,
    });
    const content = this.imageFiles.get(
      this.aliases.get(body.source.alias) ?? '',
    );
    if (content !== undefined) instance.files = copyFiles(content);
    this.instances.set(body.name, instance);
    return this.startOperation(async () => {
      if (body.start) await this.start(instance);
    });
  }

  /**
   * Incus's project limits. A count limit is checked against the instances
   * there are. An aggregate limit (cpu, memory, processes) is the sum of the
   * same instance limit over all instances, and Incus refuses an instance that
   * does not define the limit itself or through its profile; a disk limit
   * likewise wants a size on the root device.
   */
  private checkProjectLimits(body: CreateBody): void {
    const config = this.projectConfig;
    const project = this.options.project;
    const existing = [...this.instances.values()];
    for (const key of ['limits.instances', 'limits.containers']) {
      const limit = config[key];
      if (
        limit !== undefined &&
        limit !== '' &&
        existing.length + 1 > Number(limit)
      ) {
        throw new FakeFailure(
          400,
          `Reached maximum number of instances in project "${project}"`,
        );
      }
    }
    for (const key of ['limits.cpu', 'limits.memory', 'limits.processes']) {
      const limit = config[key];
      if (limit === undefined || limit === '') continue;
      const own = body.config[key] ?? this.profileConfig[key] ?? '';
      if (own === '') {
        throw new FakeFailure(
          400,
          `Instance "${body.name}" in project "${project}" has no "${key}" config, either directly or via a profile`,
        );
      }
      const value = (text: string) =>
        key === 'limits.memory' ? (incusSizeBytes(text) ?? 0) : Number(text);
      let total = value(own);
      for (const other of existing) {
        total += value(other.config[key] ?? this.profileConfig[key] ?? '0');
      }
      if (total > value(limit)) {
        throw new FakeFailure(
          400,
          `Reached maximum aggregate value "${limit}" for "${key}" in project "${project}"`,
        );
      }
    }
    const diskLimited = Object.keys(config).some(
      (key) =>
        (key === 'limits.disk' || key.startsWith('limits.disk.pool.')) &&
        config[key] !== '',
    );
    if (diskLimited) {
      const root = { ...this.profileDevices.root, ...body.devices.root };
      if ((root.size ?? '') === '') {
        throw new FakeFailure(
          400,
          `Instance "${body.name}" in project "${project}" has no "size" config set on the root device either directly or via a profile`,
        );
      }
    }
  }

  /** A pool-backed disk needs its volume. A filesystem volume may serve any
   * number of instances at once (only block volumes are exclusive), so this
   * is no arbiter between two instances that mount the same workspace. */
  private checkVolumes(devices: IncusDevices): void {
    for (const device of Object.values(devices)) {
      if (
        device.type !== 'disk' ||
        device.pool === undefined ||
        device.path === '/'
      )
        continue;
      const source = device.source ?? '';
      if (!this.volumes.has(source)) {
        throw new FakeFailure(404, `Storage volume "${source}" not found`);
      }
    }
  }

  private boot(instance: FakeInstance): void {
    instance.status = 'Running';
    instance.startedAt = this.timestamp();
    if (this.assignAddresses) {
      instance.address = `10.9.0.${this.nextAddress++}`;
    }
    instance.bootEnv = this.guest.boot(instance, instanceEnvironment(instance));
    this.onStarted?.(instance);
  }

  private async start(instance: FakeInstance): Promise<void> {
    if (instance.status === 'Running')
      throw new FakeFailure(400, 'The instance is already running');
    this.boot(instance);
  }

  private async stop(instance: FakeInstance): Promise<void> {
    instance.status = 'Stopped';
    instance.address = undefined;
    instance.bootEnv = undefined;
    if (instance.ephemeral) {
      const remove = () => {
        if (this.instances.get(instance.name) === instance)
          this.instances.delete(instance.name);
      };
      if (this.deleteDelayMs > 0) setTimeout(remove, this.deleteDelayMs);
      else remove();
    }
  }

  private changeState(name: string, body: StateBody): Response {
    const instance = this.require(name);
    return this.startOperation(async () => {
      if (body.action === 'start') {
        await this.start(instance);
        return;
      }
      if (body.action === 'freeze') {
        if (instance.status !== 'Running')
          throw new FakeFailure(400, "The instance isn't running");
        instance.status = 'Frozen';
        return;
      }
      if (body.action === 'unfreeze') {
        if (instance.status !== 'Frozen')
          throw new FakeFailure(400, "The instance isn't frozen");
        instance.status = 'Running';
        return;
      }
      if (instance.status === 'Stopped')
        throw new FakeFailure(400, 'The instance is already stopped');
      if (!body.force && this.gracefulStopFails) {
        throw new FakeFailure(500, 'Instance was not shut down cleanly');
      }
      await this.stop(instance);
    });
  }

  /** Make a stop that is not forced fail, as an instance that ignores the
   * shutdown request does. */
  gracefulStopFails = false;

  private deleteInstance(name: string): Response {
    const instance = this.require(name);
    if (instance.status === 'Running')
      throw new FakeFailure(400, 'Instance is running');
    return this.startOperation(async () => {
      this.instances.delete(instance.name);
      this.onDeleted?.(instance);
    });
  }

  /** Replaces the instance's writable fields, as a PUT does. */
  private putInstance(name: string, request: RecordedRequest): Response {
    const instance = this.require(name);
    const match = request.headers['if-match'];
    if (
      match !== undefined &&
      match.replaceAll('"', '') !== this.etag(instance).replaceAll('"', '')
    ) {
      throw new FakeFailure(412, "ETag doesn't match");
    }
    const body = asRecord(request.body);
    const config = stringMap(body.config);
    const devices = devicesOf(body.devices);
    this.checkRestrictions(name, config, devices);
    this.checkVolumes(devices);
    return this.startOperation(async () => {
      instance.config = config;
      instance.devices = devices;
      if (Array.isArray(body.profiles)) {
        instance.profiles = body.profiles.filter(
          (item): item is string => typeof item === 'string',
        );
      }
      instance.ephemeral = body.ephemeral === true;
      instance.version += 1;
    });
  }

  // ---- exec ----------------------------------------------------------------------

  private startExec(
    instance: FakeInstance,
    request: RecordedRequest,
  ): Response {
    if (instance.status !== 'Running')
      throw new FakeFailure(400, 'Instance is not running');
    const body = asRecord(request.body);
    const argv = Array.isArray(body.command)
      ? body.command.filter((item): item is string => typeof item === 'string')
      : [];
    if (argv.length === 0) throw new FakeFailure(400, 'Missing command');
    const unwrapped = unwrapExecCommand(argv);
    const webSocket = body['wait-for-websocket'] === true;
    const recordOutput = body['record-output'] === true;
    const call: FakeExecCall = {
      instance,
      command: unwrapped.argv,
      argv,
      environment: {
        ...instanceEnvironment(instance),
        ...stringMap(body.environment),
      },
      user: typeof body.user === 'number' ? body.user : 0,
      group: typeof body.group === 'number' ? body.group : 0,
      cwd: typeof body.cwd === 'string' ? body.cwd : undefined,
      timeoutSeconds: unwrapped.timeoutSeconds,
      mode: webSocket ? 'websocket' : recordOutput ? 'record-output' : 'code',
    };
    this.execs.push(call);
    if (webSocket) return this.startSocketExec(call);
    // The command's shell takes its stdin file away before it runs.
    let stdin: Uint8Array = new Uint8Array();
    if (unwrapped.payloadPath !== undefined) {
      const file = instance.files.get(unwrapped.payloadPath);
      if (file === undefined) {
        return this.startOperation(async (operation) => {
          operation.metadata = { return: 2 };
        });
      }
      stdin = file.bytes ?? new TextEncoder().encode(file.content);
      instance.files.delete(unwrapped.payloadPath);
    }
    const queue = new StdinQueue();
    queue.push(stdin);
    queue.end();
    const output: Record<1 | 2, Uint8Array[]> = { 1: [], 2: [] };
    const io: FakeExecIo = {
      stdin: () => queue.all(),
      stdinChunks: () => queue.iterate(),
      write: (fd, data) => {
        output[fd].push(
          typeof data === 'string' ? new TextEncoder().encode(data) : data,
        );
      },
      signals: [],
      killed: new AbortController().signal,
    };
    return this.startOperation(async (operation) => {
      const code = await this.exec(call, io);
      const metadata: Record<string, unknown> = { return: code };
      if (recordOutput) {
        const id = operation.id;
        const names = {
          1: `exec_${id}.stdout`,
          2: `exec_${id}.stderr`,
        } as const;
        for (const fd of [1, 2] as const) {
          instance.logs.set(
            `exec-output/${names[fd]}`,
            Buffer.concat(output[fd]),
          );
        }
        metadata.output = {
          '1': `/1.0/instances/${instance.name}/logs/exec-output/${names[1]}`,
          '2': `/1.0/instances/${instance.name}/logs/exec-output/${names[2]}`,
        };
      }
      operation.metadata = metadata;
    });
  }

  private startSocketExec(call: FakeExecCall): Response {
    const secret = () =>
      createHash('sha256').update(crypto.randomUUID()).digest('hex');
    const secrets = {
      '0': secret(),
      '1': secret(),
      '2': secret(),
      control: secret(),
    };
    let finish: (code: number) => void = () => undefined;
    const exited = new Promise<number>((resolve) => {
      finish = resolve;
    });
    return this.startOperation(
      async (operation) => {
        const code = await exited;
        operation.metadata = { fds: secrets, return: code };
      },
      {
        metadata: { fds: secrets },
        created: (operation) => {
          this.socketExecs.set(operation.id, {
            call,
            secrets,
            sockets: new Map(),
            operation,
            stdin: new StdinQueue(),
            signals: [],
            killed: new AbortController(),
            started: false,
            finish,
          });
        },
      },
    );
  }

  private websocketPort(): number {
    if (this.socketServer === undefined) {
      this.socketServer = Bun.serve<{ id: string; fd: string }>({
        hostname: '127.0.0.1',
        port: 0,
        fetch: (req, server) => {
          const url = new URL(req.url);
          const match = /^\/1\.0\/operations\/([^/]+)\/websocket$/.exec(
            url.pathname,
          );
          const pending =
            match?.[1] === undefined
              ? undefined
              : this.socketExecs.get(match[1]);
          const secret = url.searchParams.get('secret');
          const fd = Object.entries(pending?.secrets ?? {}).find(
            ([, value]) => value === secret,
          )?.[0];
          if (
            pending === undefined ||
            fd === undefined ||
            pending.sockets.has(fd)
          ) {
            return new Response('not found', { status: 404 });
          }
          if (server.upgrade(req, { data: { id: pending.operation.id, fd } }))
            return undefined;
          return new Response('upgrade failed', { status: 400 });
        },
        websocket: {
          open: (ws) => {
            const pending = this.socketExecs.get(ws.data.id);
            if (pending === undefined) return;
            pending.sockets.set(ws.data.fd, ws);
            if (pending.sockets.size === 4 && !pending.started) {
              pending.started = true;
              void this.runSocketExec(pending);
            }
          },
          message: (ws, message) => {
            const pending = this.socketExecs.get(ws.data.id);
            if (pending === undefined) return;
            if (ws.data.fd === '0') {
              if (typeof message === 'string') {
                if (message === '') pending.stdin.end();
              } else pending.stdin.push(new Uint8Array(message));
            } else if (
              ws.data.fd === 'control' &&
              typeof message === 'string'
            ) {
              const parsed = asRecord(JSON.parse(message));
              if (
                parsed.command === 'signal' &&
                typeof parsed.signal === 'number'
              )
                pending.signals.push(parsed.signal);
            }
          },
          close: (ws) => {
            const pending = this.socketExecs.get(ws.data.id);
            if (pending === undefined) return;
            if (ws.data.fd === 'control') {
              pending.killed.abort();
              pending.stdin.end();
            }
            if (ws.data.fd === '0') pending.stdin.end();
          },
        },
      });
      this.socketServer.unref();
    }
    return this.socketServer.port ?? 0;
  }

  private async runSocketExec(pending: PendingSocketExec): Promise<void> {
    const io: FakeExecIo = {
      stdin: () => pending.stdin.all(),
      stdinChunks: () => pending.stdin.iterate(),
      write: (fd, data) => {
        pending.sockets
          .get(String(fd))
          ?.send(
            typeof data === 'string' ? new TextEncoder().encode(data) : data,
          );
      },
      signals: pending.signals,
      killed: pending.killed.signal,
    };
    const killed = new Promise<number>((resolve) => {
      if (pending.killed.signal.aborted) resolve(137);
      pending.killed.signal.addEventListener('abort', () => resolve(137), {
        once: true,
      });
    });
    let code: number;
    try {
      code = await Promise.race([
        Promise.resolve(this.exec(pending.call, io)),
        killed,
      ]);
    } catch (error) {
      console.warn('[incus.fake] an exec handler threw:', error);
      code = 1;
    }
    for (const fd of ['1', '2']) {
      const ws = pending.sockets.get(fd);
      ws?.send('');
      ws?.close();
    }
    pending.sockets.get('0')?.close();
    this.socketExecs.delete(pending.operation.id);
    pending.finish(code);
  }

  private patchInstance(name: string, request: RecordedRequest): Response {
    const instance = this.require(name);
    const match = request.headers['if-match'];
    if (
      match !== undefined &&
      match.replaceAll('"', '') !== this.etag(instance).replaceAll('"', '')
    ) {
      throw new FakeFailure(412, "ETag doesn't match");
    }
    const body = asRecord(request.body);
    const config = { ...instance.config };
    for (const [key, value] of Object.entries(stringMap(body.config))) {
      if (value === '') delete config[key];
      else config[key] = value;
    }
    const devices = { ...instance.devices, ...devicesOf(body.devices) };
    this.checkRestrictions(name, config, devices);
    this.checkVolumes(devices);
    instance.config = config;
    instance.devices = devices;
    instance.version += 1;
    return syncOk(null);
  }
}

interface CreateBody {
  name: string;
  ephemeral: boolean;
  profiles: string[];
  config: IncusConfigMap;
  devices: IncusDevices;
  source: { type: 'image'; alias: string };
  start: boolean;
}

interface StateBody {
  action: 'start' | 'stop' | 'freeze' | 'unfreeze';
  force: boolean;
  timeout: number;
}
