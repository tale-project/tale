// The Incus backend's settings (SANDBOX_INCUS_*), read from the environment
// and held to what the backend can act on, so that a typo fails the boot in
// words rather than every create at the Incus API. Pure: the files the paths
// name are read when the backend connects (@tale/incus/tls).
//
// Every name of an object the operator made on the Incus side (project,
// profile, network, pool, image, certificates) is required: there is no
// default worth guessing, and "default" is the one project a sandbox must
// never end up in.

import { isAbsolute } from 'node:path';

import { toIncusSize } from '@tale/incus/units';

import { isIpv4Address } from '../../network-address.ts';
import type { IncusConfig, IncusEndpointConfig } from '../../types.ts';
import { readRegistryCaches } from './incus-registry-caches.ts';

type Env = Readonly<Record<string, string | undefined>>;

/** What a session with Docker inside is given beyond a session without:
 * container nesting, and the syscall interception the nested engine's
 * `mknod` and `setxattr` need to work under a user namespace. */
export const DEFAULT_INCUS_DOCKER_CONFIG: Readonly<Record<string, string>> = {
  'security.nesting': 'true',
  'security.syscalls.intercept.mknod': 'true',
  'security.syscalls.intercept.setxattr': 'true',
};

export interface IncusConfigContext {
  /** SANDBOX_EGRESS_PROXY, which this backend needs as an IPv4 literal. */
  egressProxy: string;
  /** SANDBOX_MAX_SESSIONS: the pool never holds more than the capacity. */
  maxSessions: number;
}

export interface IncusConfigResult {
  config: IncusConfig;
  warnings: string[];
}

/** The names of Incus objects: letters, digits, dots, dashes, underscores. */
const OBJECT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
/** Image aliases may also carry a path and a tag. */
const IMAGE_ALIAS_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,126}$/;
/**
 * The instance keys an operator may add to a Docker-capable session: nesting,
 * and the syscall interceptions Incus lists as ones a restricted project can
 * allow. Every other key is either one a restricted project refuses outright
 * (`security.idmap.size`, `raw.*`, the other interceptions) or one this backend
 * sets itself. All are booleans.
 */
const DOCKER_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'security.nesting',
  'security.syscalls.intercept.bpf',
  'security.syscalls.intercept.bpf.devices',
  'security.syscalls.intercept.mknod',
  'security.syscalls.intercept.mount',
  'security.syscalls.intercept.mount.fuse',
  'security.syscalls.intercept.setxattr',
  'security.syscalls.intercept.sysinfo',
]);
const MAX_POOL_SIZE = 256;

/** The variables that name one host's connection; SANDBOX_INCUS_ENDPOINTS
 * replaces all four with an entry per host. */
const CONNECTION = [
  'SANDBOX_INCUS_ENDPOINT',
  'SANDBOX_INCUS_CLIENT_CERT_FILE',
  'SANDBOX_INCUS_CLIENT_KEY_FILE',
  'SANDBOX_INCUS_SERVER_CERT_FILE',
] as const;

/** Required in either form: the defaults of every host. */
const REQUIRED_NAMES = [
  'SANDBOX_INCUS_PROJECT',
  'SANDBOX_INCUS_PROFILE',
  'SANDBOX_INCUS_NETWORK',
  'SANDBOX_INCUS_STORAGE_POOL',
  'SANDBOX_INCUS_IMAGE',
] as const;

const ENDPOINTS = 'SANDBOX_INCUS_ENDPOINTS';
const STATE_DIR = 'SANDBOX_INCUS_STATE_DIR';
/** Where the record of each session's host lives with several hosts: a
 * directory the operator gives a persistent volume. */
export const DEFAULT_INCUS_STATE_DIR = '/var/lib/tale-sandbox/incus';
/** More hosts than this is a typo or a list meant for something else. */
const MAX_ENDPOINTS = 64;
const ENDPOINT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** The keys an entry of SANDBOX_INCUS_ENDPOINTS may carry. */
const ENDPOINT_KEYS: ReadonlySet<string> = new Set([
  'name',
  'endpoint',
  'clientCertFile',
  'clientKeyFile',
  'serverCertFile',
  'project',
  'profile',
  'network',
  'storagePool',
  'image',
  'maxSessions',
  'poolSize',
  'egressProxy',
  'dns',
  'drained',
]);

function text(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function checkedName(what: string, value: string, re = OBJECT_NAME_RE) {
  if (!re.test(value)) {
    throw new Error(
      `${what} is not an Incus name (letters, digits and . _ - only): ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function objectName(env: Env, name: string, re = OBJECT_NAME_RE): string {
  return checkedName(`Env var ${name}`, text(env, name) ?? '', re);
}

function checkedPath(what: string, value: string): string {
  if (!isAbsolute(value) || value.includes('\0')) {
    throw new Error(
      `${what} must be an absolute path to a PEM file; got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function stateDir(env: Env): string {
  const value = text(env, STATE_DIR) ?? DEFAULT_INCUS_STATE_DIR;
  if (!isAbsolute(value) || value.includes('\0')) {
    throw new Error(
      `Env var ${STATE_DIR} must be an absolute directory path; got: ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function absolutePath(env: Env, name: string): string {
  return checkedPath(`Env var ${name}`, text(env, name) ?? '');
}

function flag(env: Env, name: string, fallback: boolean): boolean {
  const value = text(env, name)?.toLowerCase();
  if (value === undefined) return fallback;
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  throw new Error(
    `Env var ${name} must be true or false; got: ${JSON.stringify(value)}`,
  );
}

function size(env: Env, name: string): string | undefined {
  const value = text(env, name);
  if (value === undefined) return undefined;
  const parsed = toIncusSize(value);
  if (parsed === undefined) {
    throw new Error(
      `Env var ${name} is not a size such as 10g, 512m or 10GiB: ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

function whole(
  env: Env,
  name: string,
  fallback: number,
  range: { min: number; max: number },
): number {
  const value = text(env, name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < range.min || parsed > range.max) {
    throw new Error(
      `Env var ${name} must be a whole number from ${range.min} to ${range.max}; got: ${JSON.stringify(value)}`,
    );
  }
  return parsed;
}

function endpoint(env: Env): string {
  const name = 'SANDBOX_INCUS_ENDPOINT';
  return httpsOrigin(`Env var ${name}`, text(env, name) ?? '');
}

function httpsOrigin(what: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(
      `${what} is not a URL such as https://incus.example:8443; got: ${JSON.stringify(value)}`,
      { cause: error },
    );
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname === '' ||
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(
      `${what} must be the https origin of the Incus API (such as https://incus.example:8443) with no path, credentials or query; got: ${JSON.stringify(value)}`,
    );
  }
  return url.origin;
}

/** `SANDBOX_INCUS_IMAGE_SOURCE`: an OCI reference, registry first
 * (`ghcr.io/tale-project/tale-sandbox-runtime:v1`). */
function imageSource(env: Env): { server: string; alias: string } | undefined {
  const name = 'SANDBOX_INCUS_IMAGE_SOURCE';
  const value = text(env, name);
  if (value === undefined) return undefined;
  const slash = value.indexOf('/');
  const registry = slash === -1 ? '' : value.slice(0, slash);
  const reference = slash === -1 ? '' : value.slice(slash + 1);
  if (
    !/^[A-Za-z0-9.-]+(:[0-9]{1,5})?$/.test(registry) ||
    !(
      registry.includes('.') ||
      registry.includes(':') ||
      registry === 'localhost'
    ) ||
    !/^[A-Za-z0-9._/-]+([:@][A-Za-z0-9._:-]+)?$/.test(reference)
  ) {
    throw new Error(
      `Env var ${name} must be an OCI reference that starts with its registry, such as ghcr.io/tale-project/tale-sandbox-runtime:v1; got: ${JSON.stringify(value)}`,
    );
  }
  return { server: `https://${registry}`, alias: reference };
}

function nameservers(env: Env, ctx: IncusConfigContext): readonly string[] {
  const name = 'SANDBOX_INCUS_DNS';
  const value = text(env, name);
  if (value === undefined) return [new URL(ctx.egressProxy).hostname];
  const servers = value.split(',').map((item) => item.trim());
  if (servers.length === 0 || !servers.every((item) => isIpv4Address(item))) {
    throw new Error(
      `Env var ${name} must be a comma-separated list of IPv4 addresses; got: ${JSON.stringify(value)}`,
    );
  }
  return servers;
}

function dockerConfig(env: Env): Readonly<Record<string, string>> {
  const name = 'SANDBOX_INCUS_DOCKER_CONFIG';
  const raw = text(env, name);
  if (raw === undefined) return DEFAULT_INCUS_DOCKER_CONFIG;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Env var ${name} is not valid JSON: ${JSON.stringify(raw)}`,
      { cause: error },
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `Env var ${name} must be a JSON object of instance config, such as {"security.nesting":"true"}`,
    );
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!DOCKER_CONFIG_KEYS.has(key)) {
      throw new Error(
        `Env var ${name}: ${JSON.stringify(key)} is not a key this backend lets you set; the keys are ${[...DOCKER_CONFIG_KEYS].join(', ')}`,
      );
    }
    if (
      value !== true &&
      value !== false &&
      value !== 'true' &&
      value !== 'false'
    ) {
      throw new Error(
        `Env var ${name}: the value of ${key} must be true or false; got: ${JSON.stringify(value)}`,
      );
    }
    out[key] = String(value);
  }
  return out;
}

/** An egress proxy as this backend needs it: an http URL whose host is an
 * IPv4 literal (a session resolves no name before it reaches the proxy). */
function checkedEgressProxy(what: string, value: string): string {
  const refusal = (shown: string) =>
    `${what} must be an http URL whose host is an IPv4 address (such as http://10.20.0.2:3128): a session resolves no name before it reaches the proxy; got: ${JSON.stringify(shown)}`;
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(refusal(value), { cause: error });
  }
  if (
    url.protocol !== 'http:' ||
    !isIpv4Address(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    // A proxy URL may carry a password: the refusal never repeats it.
    const shown = new URL(url.href);
    if (shown.username !== '' || shown.password !== '') {
      shown.username = 'redacted';
      shown.password = '';
    }
    throw new Error(
      refusal(url.username === '' && url.password === '' ? value : shown.href),
    );
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface EndpointDefaults {
  project: string;
  profile: string;
  network: string;
  storagePool: string;
  image: string;
  maxSessions: number;
  poolSize: number;
  egressProxy: string;
  /** SANDBOX_INCUS_DNS when set; else each host's own egress proxy. */
  dns: readonly string[] | undefined;
}

/**
 * SANDBOX_INCUS_ENDPOINTS: a JSON array with one object per Incus host. Each
 * names its API origin and its own three certificate files; everything else
 * defaults to the SANDBOX_INCUS_* variable of the same meaning.
 */
function readEndpoints(
  raw: string,
  defaults: EndpointDefaults,
): IncusEndpointConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Env var ${ENDPOINTS} is not valid JSON`, {
      cause: error,
    });
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    parsed.length > MAX_ENDPOINTS
  ) {
    throw new Error(
      `Env var ${ENDPOINTS} must be a JSON array of 1 to ${MAX_ENDPOINTS} objects, one per Incus host, such as [{"name":"node-1","endpoint":"https://10.0.0.1:8443","clientCertFile":"/run/incus/node-1/client.crt","clientKeyFile":"/run/incus/node-1/client.key","serverCertFile":"/run/incus/node-1/server.crt"}]`,
    );
  }
  const names = new Set<string>();
  const places = new Set<string>();
  return parsed.map((item: unknown, index): IncusEndpointConfig => {
    const at = `Env var ${ENDPOINTS} entry ${index}`;
    if (!isObject(item)) throw new Error(`${at} must be an object`);
    const entry = item;
    for (const key of Object.keys(entry)) {
      if (!ENDPOINT_KEYS.has(key)) {
        throw new Error(
          `${at}: ${JSON.stringify(key)} is not a key of an endpoint; the keys are ${[...ENDPOINT_KEYS].join(', ')}`,
        );
      }
    }
    const str = (key: string): string | undefined => {
      const value = entry[key];
      if (value === undefined) return undefined;
      if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${at}: ${key} must be a non-empty string`);
      }
      return value.trim();
    };
    const required = (key: string): string => {
      const value = str(key);
      if (value === undefined) throw new Error(`${at} needs ${key}`);
      return value;
    };
    const count = (
      key: string,
      fallback: number,
      range: { min: number; max: number },
    ): number => {
      const value = entry[key];
      if (value === undefined) return fallback;
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < range.min ||
        value > range.max
      ) {
        throw new Error(
          `${at}: ${key} must be a whole number from ${range.min} to ${range.max}; got: ${JSON.stringify(value)}`,
        );
      }
      return value;
    };

    const name = required('name');
    if (!ENDPOINT_NAME_RE.test(name)) {
      throw new Error(
        `${at}: name must be lowercase letters, digits and dashes (at most 63); got: ${JSON.stringify(name)}`,
      );
    }
    if (names.has(name)) {
      throw new Error(`${at}: the name ${name} is given twice`);
    }
    names.add(name);
    const where = `${at} (${name})`;

    const origin = httpsOrigin(`${where} endpoint`, required('endpoint'));
    const project = checkedName(
      `${where} project`,
      str('project') ?? defaults.project,
    );
    // Two entries for one project of one host would count its sessions
    // twice and run two warm pools over the same standbys.
    const place = `${origin} ${project}`;
    if (places.has(place)) {
      throw new Error(
        `${where}: project ${project} at ${origin} is already another entry`,
      );
    }
    places.add(place);

    const drained = entry.drained ?? false;
    if (typeof drained !== 'boolean') {
      throw new Error(`${where}: drained must be true or false`);
    }
    const maxSessions = count('maxSessions', defaults.maxSessions, {
      min: 1,
      max: 100_000,
    });
    const poolSize = count(
      'poolSize',
      Math.min(defaults.poolSize, maxSessions),
      { min: 0, max: MAX_POOL_SIZE },
    );
    if (poolSize > maxSessions) {
      throw new Error(
        `${where}: poolSize (${poolSize}) cannot exceed its maxSessions (${maxSessions}): the warm pool and the sessions of a host together stay within its cap`,
      );
    }
    const egressProxy = checkedEgressProxy(
      `${where} egressProxy`,
      str('egressProxy') ?? defaults.egressProxy,
    );
    let dns = defaults.dns ?? [new URL(egressProxy).hostname];
    if (entry.dns !== undefined) {
      if (
        !Array.isArray(entry.dns) ||
        entry.dns.length === 0 ||
        !entry.dns.every(
          (server) => typeof server === 'string' && isIpv4Address(server),
        )
      ) {
        throw new Error(
          `${where}: dns must be a non-empty array of IPv4 addresses; got: ${JSON.stringify(entry.dns)}`,
        );
      }
      dns = entry.dns.filter(
        (server): server is string => typeof server === 'string',
      );
    }
    return {
      name,
      endpoint: origin,
      clientCertFile: checkedPath(
        `${where} clientCertFile`,
        required('clientCertFile'),
      ),
      clientKeyFile: checkedPath(
        `${where} clientKeyFile`,
        required('clientKeyFile'),
      ),
      serverCertFile: checkedPath(
        `${where} serverCertFile`,
        required('serverCertFile'),
      ),
      project,
      profile: checkedName(
        `${where} profile`,
        str('profile') ?? defaults.profile,
      ),
      network: checkedName(
        `${where} network`,
        str('network') ?? defaults.network,
      ),
      storagePool: checkedName(
        `${where} storagePool`,
        str('storagePool') ?? defaults.storagePool,
      ),
      image: checkedName(
        `${where} image`,
        str('image') ?? defaults.image,
        IMAGE_ALIAS_RE,
      ),
      maxSessions,
      // A drained host takes no session, so it keeps no standby either.
      poolSize: drained ? 0 : poolSize,
      egressProxy,
      dns,
      drained,
    };
  });
}

/**
 * The Incus backend's configuration, or a thrown error that names the
 * variable to change. `warnings` are what is allowed and worth saying at boot.
 */
export function readIncusConfig(
  env: Env,
  ctx: IncusConfigContext,
): IncusConfigResult {
  const several = text(env, ENDPOINTS);
  if (several !== undefined) {
    const both = CONNECTION.filter((name) => text(env, name) !== undefined);
    if (both.length > 0) {
      throw new Error(
        `${ENDPOINTS} names every host's connection, so ${both.join(', ')} must be unset beside it`,
      );
    }
  }
  const missing = [
    ...(several === undefined ? CONNECTION : []),
    ...REQUIRED_NAMES,
  ].filter((name) => text(env, name) === undefined);
  if (missing.length > 0) {
    throw new Error(
      `SANDBOX_BACKEND=incus needs ${missing.join(', ')}; see services/sandbox/docs/incus.md for what each names on the Incus side`,
    );
  }

  // With several hosts each entry is held to it (its own, or this one).
  const proxyHost = new URL(ctx.egressProxy).hostname;
  if (several === undefined && !isIpv4Address(proxyHost)) {
    throw new Error(
      `SANDBOX_EGRESS_PROXY must name an IPv4 address (such as http://10.20.0.2:3128) under SANDBOX_BACKEND=incus: a session resolves no name before it reaches the proxy; got: ${JSON.stringify(ctx.egressProxy)}`,
    );
  }

  const poolSize = whole(env, 'SANDBOX_INCUS_POOL_SIZE', 0, {
    min: 0,
    max: MAX_POOL_SIZE,
  });
  if (poolSize > ctx.maxSessions) {
    throw new Error(
      `Env var SANDBOX_INCUS_POOL_SIZE (${poolSize}) cannot exceed SANDBOX_MAX_SESSIONS (${ctx.maxSessions}): the warm pool and the sessions together stay within the capacity`,
    );
  }

  const allowUnfilteredNetwork = flag(
    env,
    'SANDBOX_INCUS_ALLOW_UNFILTERED_NETWORK',
    false,
  );
  const warnings: string[] = [];
  if (allowUnfilteredNetwork) {
    warnings.push(
      'SANDBOX_INCUS_ALLOW_UNFILTERED_NETWORK is on: sessions are not required to sit behind a network ACL. Use it for a lab only.',
    );
  }

  const source = imageSource(env);
  const registryCaches = readRegistryCaches(env);
  const project = objectName(env, 'SANDBOX_INCUS_PROJECT');
  const profile = objectName(env, 'SANDBOX_INCUS_PROFILE');
  const network = objectName(env, 'SANDBOX_INCUS_NETWORK');
  const storagePool = objectName(env, 'SANDBOX_INCUS_STORAGE_POOL');
  const image = objectName(env, 'SANDBOX_INCUS_IMAGE', IMAGE_ALIAS_RE);
  const dns = nameservers(env, ctx);
  const endpoints =
    several === undefined
      ? undefined
      : readEndpoints(several, {
          project,
          profile,
          network,
          storagePool,
          image,
          maxSessions: ctx.maxSessions,
          poolSize,
          egressProxy: ctx.egressProxy,
          dns: text(env, 'SANDBOX_INCUS_DNS') === undefined ? undefined : dns,
        });
  if (endpoints !== undefined && endpoints.every((entry) => entry.drained)) {
    warnings.push(
      `every endpoint of ${ENDPOINTS} is drained: the spawner serves the sessions they hold and starts no new one`,
    );
  }
  const first = endpoints?.[0];
  const config: IncusConfig = {
    endpoint: first?.endpoint ?? endpoint(env),
    project,
    profile,
    network,
    storagePool,
    image,
    ...(source === undefined ? {} : { imageSource: source }),
    clientCertFile:
      first?.clientCertFile ??
      absolutePath(env, 'SANDBOX_INCUS_CLIENT_CERT_FILE'),
    clientKeyFile:
      first?.clientKeyFile ??
      absolutePath(env, 'SANDBOX_INCUS_CLIENT_KEY_FILE'),
    serverCertFile:
      first?.serverCertFile ??
      absolutePath(env, 'SANDBOX_INCUS_SERVER_CERT_FILE'),
    poolSize,
    workspaceSize: size(env, 'SANDBOX_INCUS_WORKSPACE_SIZE') ?? '10GiB',
    dns,
    dockerConfig: dockerConfig(env),
    allowUnfilteredNetwork,
    ...(registryCaches === undefined ? {} : { registryCaches }),
    apiTimeoutMs: whole(env, 'SANDBOX_INCUS_API_TIMEOUT_MS', 15_000, {
      min: 1_000,
      max: 300_000,
    }),
    ...(endpoints === undefined ? {} : { endpoints, stateDir: stateDir(env) }),
  };
  if (endpoints === undefined && text(env, STATE_DIR) !== undefined) {
    warnings.push(
      `${STATE_DIR} has no effect with one Incus host: only ${ENDPOINTS} records where each session lives`,
    );
  }
  return { config, warnings };
}
