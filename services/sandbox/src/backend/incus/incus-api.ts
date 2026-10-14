// The Incus REST API objects this backend reads and writes — only the fields
// it uses, as the API documents them
// (https://linuxcontainers.org/incus/docs/main/rest-api/). Every object comes
// from a peer the connection is pinned to, but a field is still checked
// before it is used: a parser here refuses a shape the backend could not act
// on, naming the object, instead of letting `undefined` travel.

/** A string-to-string map: instance, volume and profile `config`. */
export type IncusConfigMap = Record<string, string>;

/** Instance devices by device name; each device is a string-to-string map. */
export type IncusDevices = Record<string, Record<string, string>>;

/** Numeric status codes of the API ("use this rather than the text"). */
export const INCUS_STATUS = {
  stopped: 102,
  running: 103,
  starting: 106,
  stopping: 107,
  error: 112,
  /** A background operation that ended well. */
  success: 200,
  /** A background operation that failed. */
  failure: 400,
  /** A background operation that was cancelled. */
  cancelled: 401,
} as const;

/** An Incus API call that did not succeed. `status` is the HTTP status of
 * the answer, or of the operation's failure where Incus names none (500). */
export class IncusApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'IncusApiError';
  }
}

/** The HTTP status of an Incus API failure; undefined for anything else (a
 * transport error, an abort). */
export function incusStatus(error: unknown): number | undefined {
  return error instanceof IncusApiError ? error.status : undefined;
}

export interface IncusServerInfo {
  apiExtensions: readonly string[];
  /** The optional kernel features the server reports (`kernel_features`):
   * name to `true`/`false`; empty when the server says nothing. */
  kernelFeatures: Readonly<Record<string, string>>;
  /** `trusted` once the client certificate is in the server's trust store. */
  auth: string;
  serverName: string;
  serverVersion: string;
}

export interface IncusProject {
  name: string;
  config: IncusConfigMap;
}

export interface IncusProfile {
  name: string;
  config: IncusConfigMap;
  devices: IncusDevices;
}

export interface IncusNetwork {
  name: string;
  type: string;
  managed: boolean;
  config: IncusConfigMap;
}

export interface IncusStoragePool {
  name: string;
  driver: string;
}

export interface IncusInstance {
  name: string;
  status: string;
  statusCode: number;
  ephemeral: boolean;
  config: IncusConfigMap;
  devices: IncusDevices;
  profiles: readonly string[];
  /** Immutable for the life of the instance: Incus's own creation time, which
   * a replacement under the same name cannot share. */
  createdAt: string;
}

export interface IncusNetworkAddress {
  family: string;
  address: string;
  scope: string;
}

export interface IncusInstanceState {
  status: string;
  statusCode: number;
  /** Interface name → addresses, or empty while the instance is not running. */
  network: Record<string, readonly IncusNetworkAddress[]>;
}

/** A background operation, as /1.0/operations/<id>[/wait] answers it. */
export interface IncusOperation {
  id: string;
  status: string;
  statusCode: number;
  /** The failure message of an operation that failed. */
  err: string;
  mayCancel: boolean;
  metadata: unknown;
}

export interface IncusVolume {
  name: string;
  config: IncusConfigMap;
  /** Epoch ms; 0 on a server without the `storage_volumes_created_at`
   * extension. */
  createdAtMs: number;
  /** Instance URLs that use the volume. */
  usedBy: readonly string[];
}

export interface IncusImageAlias {
  name: string;
  /** The fingerprint the alias points at. */
  target: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function malformed(what: string, why: string): IncusApiError {
  return new IncusApiError(`Incus answered a malformed ${what}: ${why}`, 502);
}

function record(raw: unknown, what: string): Record<string, unknown> {
  if (!isRecord(raw)) throw malformed(what, 'not an object');
  return raw;
}

function text(obj: Record<string, unknown>, key: string, what: string): string {
  const value = obj[key];
  if (typeof value !== 'string') throw malformed(what, `${key} is not text`);
  return value;
}

function optionalText(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === 'string' ? value : '';
}

function whole(obj: Record<string, unknown>, key: string, what: string) {
  const value = obj[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw malformed(what, `${key} is not a number`);
  }
  return value;
}

/** Keeps the entries whose value is text; Incus config values always are. */
export function stringMap(raw: unknown): IncusConfigMap {
  const out: IncusConfigMap = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

export function devicesOf(raw: unknown): IncusDevices {
  const out: IncusDevices = {};
  if (!isRecord(raw)) return out;
  for (const [name, device] of Object.entries(raw)) {
    out[name] = stringMap(device);
  }
  return out;
}

function stringList(raw: unknown): string[] {
  return Array.isArray(raw)
    ? raw.filter((item): item is string => typeof item === 'string')
    : [];
}

export function parseServerInfo(raw: unknown): IncusServerInfo {
  const obj = record(raw, 'server description');
  const environment = isRecord(obj.environment) ? obj.environment : {};
  return {
    apiExtensions: stringList(obj.api_extensions),
    kernelFeatures: stringMap(environment.kernel_features),
    auth: optionalText(obj, 'auth'),
    serverName: optionalText(environment, 'server_name'),
    serverVersion: optionalText(environment, 'server_version'),
  };
}

export function parseProject(raw: unknown): IncusProject {
  const obj = record(raw, 'project');
  return {
    name: text(obj, 'name', 'project'),
    config: stringMap(obj.config),
  };
}

export function parseProfile(raw: unknown): IncusProfile {
  const obj = record(raw, 'profile');
  return {
    name: text(obj, 'name', 'profile'),
    config: stringMap(obj.config),
    devices: devicesOf(obj.devices),
  };
}

export function parseNetwork(raw: unknown): IncusNetwork {
  const obj = record(raw, 'network');
  return {
    name: text(obj, 'name', 'network'),
    type: optionalText(obj, 'type'),
    managed: obj.managed === true,
    config: stringMap(obj.config),
  };
}

export function parseStoragePool(raw: unknown): IncusStoragePool {
  const obj = record(raw, 'storage pool');
  return {
    name: text(obj, 'name', 'storage pool'),
    driver: text(obj, 'driver', 'storage pool'),
  };
}

export function parseInstance(raw: unknown): IncusInstance {
  const obj = record(raw, 'instance');
  return {
    name: text(obj, 'name', 'instance'),
    status: optionalText(obj, 'status'),
    statusCode: whole(obj, 'status_code', 'instance'),
    ephemeral: obj.ephemeral === true,
    config: stringMap(obj.config),
    devices: devicesOf(obj.devices),
    profiles: stringList(obj.profiles),
    createdAt: optionalText(obj, 'created_at'),
  };
}

export function parseInstanceState(raw: unknown): IncusInstanceState {
  const obj = record(raw, 'instance state');
  const network: Record<string, IncusNetworkAddress[]> = {};
  if (isRecord(obj.network)) {
    for (const [name, nic] of Object.entries(obj.network)) {
      if (!isRecord(nic)) continue;
      const addresses: IncusNetworkAddress[] = [];
      if (Array.isArray(nic.addresses)) {
        for (const entry of nic.addresses) {
          if (!isRecord(entry)) continue;
          addresses.push({
            family: optionalText(entry, 'family'),
            address: optionalText(entry, 'address'),
            scope: optionalText(entry, 'scope'),
          });
        }
      }
      network[name] = addresses;
    }
  }
  return {
    status: optionalText(obj, 'status'),
    statusCode: whole(obj, 'status_code', 'instance state'),
    network,
  };
}

export function parseOperation(raw: unknown): IncusOperation {
  const obj = record(raw, 'operation');
  return {
    id: text(obj, 'id', 'operation'),
    status: optionalText(obj, 'status'),
    statusCode: whole(obj, 'status_code', 'operation'),
    err: optionalText(obj, 'err'),
    mayCancel: obj.may_cancel === true,
    metadata: obj.metadata,
  };
}

export function parseVolume(raw: unknown): IncusVolume {
  const obj = record(raw, 'storage volume');
  const created = optionalText(obj, 'created_at');
  const createdAtMs = created === '' ? 0 : Date.parse(created);
  return {
    name: text(obj, 'name', 'storage volume'),
    config: stringMap(obj.config),
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
    usedBy: stringList(obj.used_by),
  };
}

export function parseImageAlias(raw: unknown): IncusImageAlias {
  const obj = record(raw, 'image alias');
  return {
    name: text(obj, 'name', 'image alias'),
    target: text(obj, 'target', 'image alias'),
  };
}

/** The body of a POST /1.0/instances this backend sends. */
export interface IncusInstanceCreate {
  name: string;
  ephemeral: boolean;
  profiles: readonly string[];
  config: IncusConfigMap;
  devices: IncusDevices;
  source: { type: 'image'; alias: string };
  /** Start it in the same background operation (`instance_create_start`). */
  start: boolean;
}

/** The body of a POST /1.0/storage-pools/<pool>/volumes/custom. */
export interface IncusVolumeCreate {
  name: string;
  type: 'custom';
  content_type: 'filesystem';
  config: IncusConfigMap;
}
