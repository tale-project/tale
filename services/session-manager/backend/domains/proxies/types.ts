// What a proxy is, and the seam to look at its exit IP. Parsing a user's text
// into a `ProxyConfig` is `parsing.ts`; the real checker is `exit-ip.ts`.

import { createHash } from 'node:crypto';

import type { Scheme } from '../../../lib/api/schemas.ts';

export type ProxyScheme = Scheme;

export interface ProxyConfig {
  scheme: ProxyScheme;
  /** A lowercased host name or canonical IP literal (IPv6 without brackets). */
  host: string;
  port: number;
  username: string | null;
  password: string | null;
}

export function hasAuth(proxy: ProxyConfig): boolean {
  return proxy.username !== null;
}

export function hostPort(proxy: ProxyConfig): string {
  const host = proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host;
  return `${host}:${proxy.port}`;
}

/** The credential-free proxy URL, e.g. `http://1.2.3.4:8080`. */
function serverUrl(proxy: ProxyConfig): string {
  return `${proxy.scheme}://${hostPort(proxy)}`;
}

/** The password-free form for the UI and logs. */
export function displayOf(proxy: ProxyConfig): string {
  const user = hasAuth(proxy) ? `${proxy.username}@` : '';
  return `${proxy.scheme}://${user}${hostPort(proxy)}`;
}

/**
 * The dedupe key: host + port + username + sha256(password), scheme ignored.
 *
 * Residential providers encode the sticky session in the username (or the
 * password) behind one shared host:port, so different credentials usually mean
 * a different upstream session.
 */
export function identityKeyOf(proxy: ProxyConfig): string {
  const digest = hasAuth(proxy)
    ? createHash('sha256')
        .update(proxy.password ?? '')
        .digest('hex')
    : '';
  return `${hostPort(proxy)}|${proxy.username ?? ''}|${digest}`;
}

/**
 * The Playwright proxy setting for a proxy WITHOUT credentials.
 *
 * The browser never gets proxy credentials: Firefox refuses them for SOCKS5,
 * and for HTTP(S) it answers the 407 challenge for page requests only, so
 * background requests fail. A proxy with credentials goes through a local
 * `ProxyBridge` instead.
 */
export function toPlaywrightProxy(proxy: ProxyConfig): { server: string } {
  if (hasAuth(proxy)) {
    throw new Error(
      'a proxy with credentials must go through a local ProxyBridge',
    );
  }
  return { server: serverUrl(proxy) };
}

export interface ExitIp {
  ip: string;
  /** ISO 3166-1 alpha-2, from the local GeoIP database. */
  country: string | null;
  latencyMs: number;
}

/**
 * The exit IP could not be determined through the proxy. The message is for
 * the person using the app.
 */
export class ExitIpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExitIpError';
  }
}

export interface ExitIpChecker {
  /** Rejects with an `ExitIpError`. */
  check(proxy: ProxyConfig): Promise<ExitIp>;
}

/**
 * A running local HTTP proxy that forwards to a proxy with credentials and adds
 * them (see `bridge.ts`). Its address is what the browser is given.
 */
export interface RunningBridge {
  readonly port: number;
  /** `{ server: 'http://127.0.0.1:<port>' }` */
  readonly playwrightProxy: { server: string };
  close(): Promise<void>;
}
