// An in-memory Incus, for the Incus backend's tests: the REST API the client
// speaks, answered from a few maps, without a socket. It models what the
// backend relies on — async operations, ETag preconditions, ephemeral
// instances deleted on stop, volumes that are in use, a restricted project
// that refuses what a real one refuses — and records every request, so a
// test can say what the backend asked for as well as what came of it.
//
// The runnerd inside each fake instance is modelled too (FakeRunnerd): it
// boots from the instance's environment, or from the claim file a standby
// receives, and answers the readiness poll with the incarnation it booted.
//
// Not used by production code.

import { createHash } from 'node:crypto';

import type { RunnerdHealth } from '../../session/runnerd-protocol.ts';
import {
  devicesOf,
  INCUS_STATUS,
  type IncusConfigMap,
  type IncusDevices,
  stringMap,
} from './incus-api.ts';
import { IncusClient, type IncusFetch } from './incus-client.ts';
import {
  STANDBY_CLAIM_END,
  STANDBY_CLAIM_FILE,
  STANDBY_READY_FILE,
} from './incus-standby.ts';
import { incusSizeBytes } from './incus-units.ts';

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

export interface FakeInstance {
  name: string;
  status: 'Running' | 'Stopped' | 'Starting' | 'Error';
  ephemeral: boolean;
  config: IncusConfigMap;
  devices: IncusDevices;
  profiles: string[];
  createdAt: string;
  address: string | undefined;
  files: Map<string, { content: string; mode: string }>;
  consoleLog: string;
  /** The environment the instance's main process booted with; undefined
   * until it has (a standby is only a waiting script). */
  bootEnv: Record<string, string> | undefined;
  version: number;
}

export interface FakeVolume {
  name: string;
  config: IncusConfigMap;
  createdAt: string;
}

interface FakeOperation {
  id: string;
  statusCode: number;
  err: string;
  settled: Promise<void>;
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
  if (action !== 'start' && action !== 'stop') {
    throw new FakeFailure(400, `Unknown state action ${String(action)}`);
  }
  return { action, force: body.force === true };
}

const STATUS_CODE: Record<FakeInstance['status'], number> = {
  Running: INCUS_STATUS.running,
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
  projectConfig: IncusConfigMap = {
    'features.images': 'true',
    'features.profiles': 'true',
    'features.storage.volumes': 'true',
    restricted: 'true',
    'restricted.containers.nesting': 'allow',
    'restricted.containers.interception': 'allow',
    'restricted.devices.disk': 'allow',
    'restricted.devices.disk.paths': 'tmpfs:',
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
  /** Image pulls fail with this message when set. */
  pullFailure: string | undefined;

  private readonly rules: Array<FailureRule & { left: number }> = [];
  private readonly holds: Array<{ pattern: RegExp; gate: Promise<void> }> = [];
  private readonly operations = new Map<string, FakeOperation>();
  private nextAddress = 10;
  private tick = 0;
  private nextOperation = 1;

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
  }

  /** A client wired to this fake. */
  client(overrides: { requestTimeoutMs?: number } = {}): IncusClient {
    return new IncusClient({
      endpoint: 'https://incus.fake:8443',
      project: this.options.project,
      tls: { ca: 'ca', cert: 'cert', key: 'key' },
      fetch: this.fetch,
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
    if (typeof init.body === 'string') body = JSON.parse(init.body);
    else if (init.body instanceof Uint8Array) {
      body = new TextDecoder().decode(init.body);
    }
    const request: RecordedRequest = {
      method: init.method,
      path: parsed.pathname,
      query,
      headers: init.headers,
      body,
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
        },
      });
    }
    if (this.auth !== 'trusted') throw new FakeFailure(403, 'not authorized');
    const { project } = request.query;
    switch (area) {
      case 'projects':
        return this.getProject(a);
      case 'profiles':
        this.requireProject(project);
        return this.getProfile(a);
      case 'networks':
        this.requireProject(project);
        return this.getNetwork(a);
      case 'storage-pools':
        if (b === undefined) return this.getPool(a);
        if (b === 'volumes' && c === 'custom') {
          this.requireProject(project);
          return this.volumeRoute(method, a, d, request);
        }
        break;
      case 'instances':
        this.requireProject(project);
        return this.instanceRoute(method, a, b, request);
      case 'operations':
        if (b === 'wait') return this.waitOperation(a, request);
        break;
      case 'images':
        this.requireProject(project);
        if (a === 'aliases' && method === 'GET') return this.getAlias(b);
        if (a === undefined && method === 'POST')
          return this.pullImage(request);
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

  private getAlias(alias: string | undefined): Response {
    const target = alias === undefined ? undefined : this.aliases.get(alias);
    if (alias === undefined || target === undefined) {
      throw new FakeFailure(404, 'Image alias not found');
    }
    return syncOk({ name: alias, target });
  }

  private pullImage(request: RecordedRequest): Response {
    const body = asRecord(request.body);
    const names = (Array.isArray(body.aliases) ? body.aliases : [])
      .map((alias) => asRecord(alias).name)
      .filter((name): name is string => typeof name === 'string');
    return this.startOperation(async () => {
      if (this.pullFailure !== undefined)
        throw new FakeFailure(500, this.pullFailure);
      for (const name of names) {
        this.aliases.set(
          name,
          createHash('sha256')
            .update(JSON.stringify(body.source))
            .digest('hex'),
        );
      }
    });
  }

  // ---- operations ----------------------------------------------------------

  private startOperation(work: () => Promise<void>): Response {
    const id = `op-${this.nextOperation++}`;
    const operation: FakeOperation = {
      id,
      statusCode: INCUS_STATUS.running,
      err: '',
      settled: Promise.resolve(),
    };
    operation.settled = (async () => {
      try {
        await work();
        operation.statusCode = INCUS_STATUS.success;
      } catch (error) {
        operation.statusCode = INCUS_STATUS.failure;
        operation.err = error instanceof Error ? error.message : String(error);
      }
    })();
    this.operations.set(id, operation);
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
      may_cancel: false,
      metadata: null,
    };
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

  private volumeUsedBy(name: string): string[] {
    return [...this.instances.values()]
      .filter((instance) =>
        Object.values(instance.devices).some(
          (device) =>
            device.type === 'disk' &&
            device.pool === this.options.pool &&
            device.source === name,
        ),
      )
      .map(
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
    }
    throw new FakeFailure(
      404,
      `not implemented in the fake: ${method} ${request.path}`,
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
      bootEnv: undefined,
      version: 1,
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
      if (method === 'DELETE') return this.deleteInstance(name);
    } else if (sub === 'state' && method === 'PUT') {
      return this.changeState(name, parseStateBody(request.body));
    } else if (sub === 'files') {
      return this.files(method, name, request);
    } else if (sub === 'console' && method === 'GET') {
      return new Response(this.require(name).consoleLog);
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
    if (this.assignAddresses) {
      instance.address = `10.9.0.${this.nextAddress++}`;
    }
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(instance.config)) {
      if (key.startsWith('environment.'))
        env[key.slice('environment.'.length)] = value;
    }
    const entrypoint = instance.config['oci.entrypoint'] ?? '';
    // A standby only waits, and says so; the session boots when its claim
    // arrives.
    const standby = entrypoint.includes('standby.sh');
    if (standby)
      instance.files.set(STANDBY_READY_FILE, { content: '', mode: '' });
    instance.bootEnv = standby ? undefined : env;
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
    });
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

  private files(
    method: string,
    name: string,
    request: RecordedRequest,
  ): Response {
    const instance = this.require(name);
    const path = request.query.path;
    if (path === undefined) throw new FakeFailure(400, 'Missing path argument');
    if (method === 'HEAD') {
      if (!instance.files.has(path)) throw new FakeFailure(404, 'not found');
      return new Response(null, { status: 200 });
    }
    if (method === 'POST') {
      const content = typeof request.body === 'string' ? request.body : '';
      instance.files.set(path, {
        content,
        mode: request.headers['x-incus-mode'] ?? '',
      });
      if (path === STANDBY_CLAIM_FILE) this.claimed(instance, content);
      return syncOk(null);
    }
    throw new FakeFailure(
      404,
      `not implemented in the fake: ${method} ${request.path}`,
    );
  }

  /** The standby script becomes the entrypoint once a complete claim is
   * there: its variables are the environment the session boots with. */
  private claimed(instance: FakeInstance, content: string): void {
    if (instance.status !== 'Running' || !content.includes(STANDBY_CLAIM_END))
      return;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(instance.config)) {
      if (key.startsWith('environment.'))
        env[key.slice('environment.'.length)] = value;
    }
    for (const match of content.matchAll(
      /^export ([A-Z][A-Z0-9_]*)='([^']*)'$/gm,
    )) {
      const [, key, value] = match;
      if (key !== undefined && value !== undefined) env[key] = value;
    }
    instance.bootEnv = env;
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
  action: 'start' | 'stop';
  force: boolean;
}

/**
 * The runnerd of each fake instance, as the backend's readiness poll sees it:
 * it answers only once the instance's main process has booted, only to the
 * token it booted with, and names the incarnation it booted with.
 */
export class FakeRunnerd {
  /** Failing health polls to answer before succeeding. */
  failFirst = 0;
  dockerReady: boolean | undefined;
  /** Env keys runnerd refuses on a seed. */
  denied: string[] = [];
  readonly polls: string[] = [];
  readonly patches: Array<{ baseUrl: string; set: Record<string, string> }> =
    [];
  patchFailure: string | undefined;
  private readonly misses = new Map<string, number>();

  constructor(private readonly incus: FakeIncus) {}

  private instanceAt(baseUrl: string): FakeInstance | undefined {
    return this.incus.instanceByAddress(new URL(baseUrl).hostname);
  }

  readonly health = async (
    opts: { baseUrl: string; token: string },
    signal?: AbortSignal,
  ): Promise<RunnerdHealth> => {
    signal?.throwIfAborted();
    this.polls.push(opts.baseUrl);
    const seen = (this.misses.get(opts.baseUrl) ?? 0) + 1;
    this.misses.set(opts.baseUrl, seen);
    if (seen <= this.failFirst) throw new Error('connection refused');
    const instance = this.instanceAt(opts.baseUrl);
    if (instance?.bootEnv === undefined) throw new Error('connection refused');
    if (instance.bootEnv.TALE_RUNNERD_TOKEN !== opts.token)
      throw new Error('runnerd /healthz 401');
    const incarnation = instance.bootEnv.TALE_RUNNERD_INCARNATION;
    return {
      ok: true,
      ...(this.dockerReady === undefined
        ? {}
        : { dockerReady: this.dockerReady }),
      bootedAtMs: 0,
      ...(incarnation === undefined ? {} : { incarnation }),
      lastActivityAtMs: 0,
      liveExecs: 0,
    };
  };

  readonly envPatch = async (
    opts: { baseUrl: string; token: string },
    patch: { set?: Record<string, string>; unset?: string[] },
    signal?: AbortSignal,
  ): Promise<string[]> => {
    signal?.throwIfAborted();
    if (this.patchFailure !== undefined) throw new Error(this.patchFailure);
    this.patches.push({ baseUrl: opts.baseUrl, set: patch.set ?? {} });
    return this.denied;
  };
}
