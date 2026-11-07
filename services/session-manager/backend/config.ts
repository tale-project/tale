import { join, resolve } from 'node:path';

/** The default port, shared with the dev server. */
export const DEFAULT_PORT = 3004;

export interface Config {
  /** Interface to bind. There is no login, so the default is the loopback. */
  host: string;
  port: number;
  /** Holds `manager.db`, `profiles/<session id>/` and the Camoufox browser. */
  dataDir: string;
  /** `RTCPeerConnection` is removed from every browser (detectable). */
  blockWebrtc: boolean;
  /**
   * The `Host` header values that address the app. Anything else is refused,
   * which blocks DNS rebinding.
   */
  allowedHosts: ReadonlySet<string>;
  /** Where `camoufox-js` installs and finds its browser build. */
  camoufoxInstallDir: string;
  /** The built single-page app. */
  distDir: string;
  version: string;
}

/** A setting of the environment that cannot be used. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function flag(value: string | undefined): boolean {
  return TRUE_VALUES.has((value ?? '').trim().toLowerCase());
}

/**
 * Bound to these, the app answers on every interface: they are not a name
 * anyone opens it by (a page of another website can still make a browser send
 * a request to 0.0.0.0).
 */
const WILDCARD_ADDRESSES: ReadonlySet<string> = new Set(['0.0.0.0', '::']);

/**
 * The `Host` values for a bind address and port, plus the operator's own. A
 * wildcard bind address adds nothing: `127.0.0.1` and `localhost` stay the
 * names, and a published port under another name is the operator's to list.
 */
export function allowedHostsFor(
  host: string,
  port: number,
  extra: readonly string[] = [],
): ReadonlySet<string> {
  const hosts = new Set<string>();
  const names = ['127.0.0.1', 'localhost'];
  if (!WILDCARD_ADDRESSES.has(host)) names.push(host);
  for (const name of names) {
    hosts.add(name.includes(':') ? `[${name}]:${port}` : `${name}:${port}`);
  }
  for (const value of extra) hosts.add(value.trim().toLowerCase());
  return hosts;
}

export interface ConfigOverrides {
  distDir?: string;
}

/**
 * The configuration from the environment:
 *
 * | Variable | Default | |
 * |---|---|---|
 * | `PORT` | `3004` | |
 * | `SESSION_MANAGER_HOST` | `127.0.0.1` | There is no login: keep it local. |
 * | `SESSION_MANAGER_DATA_DIR` | `./data` | |
 * | `SESSION_MANAGER_BLOCK_WEBRTC` | off | |
 * | `SESSION_MANAGER_ALLOWED_HOSTS` | | More `Host` values, comma separated. |
 * | `CAMOUFOX_INSTALL_DIR` | `<data dir>/camoufox` | |
 * | `TALE_VERSION` | `dev` | |
 *
 * Two more are read where they are used, and listed in `.env.example`:
 * `SESSION_MANAGER_MAX_SCREEN` (`largestScreen` in `identity/fingerprints.ts`,
 * which takes the environment as a parameter) and `DEBUG` (`lib/debug.ts`).
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  overrides: ConfigOverrides = {},
): Config {
  const port = Number(env.PORT || DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new ConfigError(`PORT must be a port number, got "${env.PORT}"`);
  }
  const host = (env.SESSION_MANAGER_HOST || '127.0.0.1').trim();
  const dataDir = resolve(env.SESSION_MANAGER_DATA_DIR || 'data');
  const extraHosts = (env.SESSION_MANAGER_ALLOWED_HOSTS ?? '')
    .split(',')
    .filter((value) => value.trim() !== '');
  return {
    host,
    port,
    dataDir,
    blockWebrtc: flag(env.SESSION_MANAGER_BLOCK_WEBRTC),
    allowedHosts: allowedHostsFor(host, port, extraHosts),
    camoufoxInstallDir: resolve(
      env.CAMOUFOX_INSTALL_DIR || join(dataDir, 'camoufox'),
    ),
    distDir: overrides.distDir ?? resolve(import.meta.dirname, '../dist'),
    version: env.TALE_VERSION || 'dev',
  };
}

export function dbPath(config: Pick<Config, 'dataDir'>): string {
  return join(config.dataDir, 'manager.db');
}

export function profilesDir(config: Pick<Config, 'dataDir'>): string {
  return join(config.dataDir, 'profiles');
}
