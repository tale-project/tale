// The Incus backend's settings (SANDBOX_INCUS_*), read from the environment
// and held to what the backend can act on, so that a typo fails the boot in
// words rather than every create at the Incus API. Pure: the files the paths
// name are read when the backend connects (incus-tls.ts).
//
// Every name of an object the operator made on the Incus side (project,
// profile, network, pool, image, certificates) is required: there is no
// default worth guessing, and "default" is the one project a sandbox must
// never end up in.

import { isAbsolute } from 'node:path';

import { isIpv4Address } from '../../network-address.ts';
import type { IncusConfig } from '../../types.ts';
import { toIncusSize } from './incus-units.ts';

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

const REQUIRED = [
  'SANDBOX_INCUS_ENDPOINT',
  'SANDBOX_INCUS_PROJECT',
  'SANDBOX_INCUS_PROFILE',
  'SANDBOX_INCUS_NETWORK',
  'SANDBOX_INCUS_STORAGE_POOL',
  'SANDBOX_INCUS_IMAGE',
  'SANDBOX_INCUS_CLIENT_CERT_FILE',
  'SANDBOX_INCUS_CLIENT_KEY_FILE',
  'SANDBOX_INCUS_SERVER_CERT_FILE',
] as const;

function text(env: Env, name: string): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function objectName(env: Env, name: string, re = OBJECT_NAME_RE): string {
  const value = text(env, name) ?? '';
  if (!re.test(value)) {
    throw new Error(
      `Env var ${name} is not an Incus name (letters, digits and . _ - only): ${JSON.stringify(value)}`,
    );
  }
  return value;
}

function absolutePath(env: Env, name: string): string {
  const value = text(env, name) ?? '';
  if (!isAbsolute(value) || value.includes('\0')) {
    throw new Error(
      `Env var ${name} must be an absolute path to a PEM file; got: ${JSON.stringify(value)}`,
    );
  }
  return value;
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
  const value = text(env, name) ?? '';
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(
      `Env var ${name} is not a URL such as https://incus.example:8443; got: ${JSON.stringify(value)}`,
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
      `Env var ${name} must be the https origin of the Incus API (such as https://incus.example:8443) with no path, credentials or query; got: ${JSON.stringify(value)}`,
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

/**
 * The Incus backend's configuration, or a thrown error that names the
 * variable to change. `warnings` are what is allowed and worth saying at boot.
 */
export function readIncusConfig(
  env: Env,
  ctx: IncusConfigContext,
): IncusConfigResult {
  const missing = REQUIRED.filter((name) => text(env, name) === undefined);
  if (missing.length > 0) {
    throw new Error(
      `SANDBOX_BACKEND=incus needs ${missing.join(', ')}; see services/sandbox/docs/incus.md for what each names on the Incus side`,
    );
  }

  const proxyHost = new URL(ctx.egressProxy).hostname;
  if (!isIpv4Address(proxyHost)) {
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
  const config: IncusConfig = {
    endpoint: endpoint(env),
    project: objectName(env, 'SANDBOX_INCUS_PROJECT'),
    profile: objectName(env, 'SANDBOX_INCUS_PROFILE'),
    network: objectName(env, 'SANDBOX_INCUS_NETWORK'),
    storagePool: objectName(env, 'SANDBOX_INCUS_STORAGE_POOL'),
    image: objectName(env, 'SANDBOX_INCUS_IMAGE', IMAGE_ALIAS_RE),
    ...(source === undefined ? {} : { imageSource: source }),
    clientCertFile: absolutePath(env, 'SANDBOX_INCUS_CLIENT_CERT_FILE'),
    clientKeyFile: absolutePath(env, 'SANDBOX_INCUS_CLIENT_KEY_FILE'),
    serverCertFile: absolutePath(env, 'SANDBOX_INCUS_SERVER_CERT_FILE'),
    poolSize,
    workspaceSize: size(env, 'SANDBOX_INCUS_WORKSPACE_SIZE') ?? '10GiB',
    dns: nameservers(env, ctx),
    dockerConfig: dockerConfig(env),
    allowUnfilteredNetwork,
    apiTimeoutMs: whole(env, 'SANDBOX_INCUS_API_TIMEOUT_MS', 15_000, {
      min: 1_000,
      max: 300_000,
    }),
  };
  return { config, warnings };
}
