/**
 * A tunnel to a video host through one of video ingestion's proxies, opened
 * by the platform for a yt-dlp that runs in a sandbox session
 * (`domains/video_links/proxy-relay.ts`, tale-project/tale#4942).
 *
 * A proxy is dialed in the scheme its entry is written in, the ones yt-dlp
 * speaks: `http`, `https` (the same over TLS to the proxy, its certificate
 * verified), `socks4`/`socks4a` and `socks5`/`socks5h`. A SOCKS proxy is
 * always handed the host by name, so it resolves it: yt-dlp's `socks5://`
 * resolves on the machine it runs on, which here would be the platform's, and
 * a proxy's own resolver is the one whose answer fits its address.
 *
 * The session manager opens the same kinds of tunnel for its browsers
 * (`services/session-manager/backend/domains/proxies/connect.ts`); the two
 * services share no package, so this one stands on Node's own CONNECT client
 * and the `socks` package and keeps to what a relay needs.
 */

import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type net from 'node:net';
import type tls from 'node:tls';

import { SocksClient } from 'socks';

/** The port a proxy of each scheme listens on when its entry names none
 * (`lib/net/video-ingest-proxies.ts`). */
const SCHEME_PORTS = {
  http: 80,
  https: 443,
  socks4: 1080,
  socks4a: 1080,
  socks5: 1080,
  socks5h: 1080,
} as const;

export type VideoProxyScheme = keyof typeof SCHEME_PORTS;

/** A proxy as the relay dials it. */
export interface VideoProxyUpstream {
  readonly scheme: VideoProxyScheme;
  readonly host: string;
  readonly port: number;
  /** `null` for a proxy without credentials. */
  readonly username: string | null;
  readonly password: string | null;
}

function isScheme(value: string): value is VideoProxyScheme {
  return Object.hasOwn(SCHEME_PORTS, value);
}

/** A proxy entry, as written for yt-dlp, read for the relay; `null` for one
 * that is no proxy URL of a scheme above. */
export function parseVideoProxyUpstream(
  proxyUrl: string,
): VideoProxyUpstream | null {
  let url: URL;
  try {
    url = new URL(proxyUrl);
  } catch {
    return null;
  }
  const scheme = url.protocol.slice(0, -1);
  if (!isScheme(scheme) || url.hostname === '') return null;
  let username: string;
  let password: string;
  try {
    username = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } catch {
    // A `%` that begins no escape: such credentials decode to nothing.
    return null;
  }
  return {
    scheme,
    // An IPv6 literal comes bracketed from the URL; a socket takes it bare.
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: url.port === '' ? SCHEME_PORTS[scheme] : Number(url.port),
    username: username === '' ? null : username,
    password: username === '' ? null : password,
  };
}

/**
 * Why a tunnel did not open:
 * - `unreachable`: the proxy itself could not be used (refused, no route,
 *   TLS failed, not the protocol its entry says);
 * - `credentials`: it refused the credentials of its entry;
 * - `timeout`: it did not answer in time;
 * - `refused`: it works and would not carry this one request, with the
 *   status it gave where it gave one.
 */
export type ProxyTunnelFailure =
  | 'unreachable'
  | 'credentials'
  | 'timeout'
  | 'refused';

/** A tunnel that did not open. The message names no credential. */
export class ProxyTunnelError extends Error {
  readonly kind: ProxyTunnelFailure;
  /** The proxy's own answer to the tunnel request, for `refused`. */
  readonly status: number | undefined;

  constructor(kind: ProxyTunnelFailure, message: string, status?: number) {
    super(message);
    this.name = 'ProxyTunnelError';
    this.kind = kind;
    this.status = status;
  }
}

export interface OpenTunnelOptions {
  /** Bounds everything up to an open tunnel. */
  readonly timeoutMs: number;
  /** Gives the attempt up; it then fails with the signal's reason. */
  readonly signal?: AbortSignal;
  /** Trust anchors to verify an `https` proxy with. For tests; the default
   * is the runtime's. */
  readonly ca?: tls.ConnectionOptions['ca'];
}

/** An open tunnel: the socket to the proxy, and whatever the proxy sent
 * after its answer, which belongs to whoever asked for the tunnel. */
export interface ProxyTunnel {
  readonly socket: net.Socket;
  readonly head: Buffer;
}

/** `host:port` as a request line carries it, an IPv6 address bracketed. */
function authority(host: string, port: number): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

function httpTunnel(
  upstream: VideoProxyUpstream,
  host: string,
  port: number,
  options: OpenTunnelOptions,
): Promise<ProxyTunnel> {
  return new Promise((resolve, reject) => {
    const target = authority(host, port);
    const request = (upstream.scheme === 'https' ? https : http).request({
      host: upstream.host,
      port: upstream.port,
      method: 'CONNECT',
      path: target,
      headers: {
        host: target,
        ...(upstream.username === null
          ? {}
          : {
              'proxy-authorization': `Basic ${Buffer.from(
                `${upstream.username}:${upstream.password ?? ''}`,
              ).toString('base64')}`,
            }),
      },
      // A connection of its own: a tunnel is no request to pool.
      agent: false,
      // The certificate is the proxy's. Node would otherwise take the name
      // to verify from the Host header, which on a CONNECT is the target's.
      // An address is no server name (RFC 6066) and is checked against the
      // certificate's own addresses.
      ...(upstream.scheme === 'https'
        ? { servername: isIP(upstream.host) === 0 ? upstream.host : '' }
        : {}),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.ca === undefined ? {} : { ca: options.ca }),
    });
    let settled = false;
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      request.destroy();
      reject(error);
    };
    const deadline = setTimeout(
      () =>
        fail(
          new ProxyTunnelError(
            'timeout',
            'the video proxy did not answer in time',
          ),
        ),
      options.timeoutMs,
    );
    request.once('connect', (response, socket, head) => {
      const status = response.statusCode ?? 0;
      if (status >= 200 && status < 300) {
        if (settled) {
          socket.destroy();
          return;
        }
        settled = true;
        clearTimeout(deadline);
        resolve({ socket, head });
        return;
      }
      socket.destroy();
      fail(
        status === 407
          ? new ProxyTunnelError(
              'credentials',
              'the video proxy refused its credentials (HTTP 407)',
            )
          : new ProxyTunnelError(
              'refused',
              `the video proxy refused the tunnel (HTTP ${status})`,
              status,
            ),
      );
    });
    request.once('error', (error) => {
      fail(
        options.signal?.aborted === true
          ? options.signal.reason
          : new ProxyTunnelError(
              'unreachable',
              `the video proxy could not be reached (${
                Reflect.get(error, 'code') ?? error.message
              })`,
            ),
      );
    });
    request.end();
  });
}

/** What the `socks` package says a failure was: it reports text only. */
function socksFailure(message: string): ProxyTunnelError {
  if (/authentication failed|no accepted authentication/i.test(message)) {
    return new ProxyTunnelError(
      'credentials',
      'the video proxy refused its credentials (SOCKS)',
    );
  }
  if (/rejected connection/i.test(message)) {
    return new ProxyTunnelError(
      'refused',
      'the video proxy refused the tunnel (SOCKS)',
    );
  }
  if (/timed out/i.test(message)) {
    return new ProxyTunnelError(
      'timeout',
      'the video proxy did not answer in time',
    );
  }
  return new ProxyTunnelError(
    'unreachable',
    'the video proxy could not be reached (SOCKS)',
  );
}

async function socksTunnel(
  upstream: VideoProxyUpstream,
  host: string,
  port: number,
  options: OpenTunnelOptions,
): Promise<ProxyTunnel> {
  const username = upstream.username;
  const password = upstream.password ?? '';
  // The package writes each length as one byte, and throws from inside a
  // socket event for a longer one.
  if (
    Buffer.byteLength(host) > 255 ||
    (username !== null &&
      (Buffer.byteLength(username) > 255 || Buffer.byteLength(password) > 255))
  ) {
    throw new ProxyTunnelError(
      'refused',
      'a SOCKS proxy takes no host name, user name or password longer than 255 bytes',
    );
  }
  let connection: Awaited<ReturnType<typeof SocksClient.createConnection>>;
  try {
    connection = await SocksClient.createConnection({
      command: 'connect',
      // A name stays a name: the proxy resolves it.
      destination: { host, port },
      proxy: {
        host: upstream.host,
        port: upstream.port,
        type: upstream.scheme.startsWith('socks4') ? 4 : 5,
        ...(username === null ? {} : { userId: username, password }),
      },
      timeout: options.timeoutMs,
    });
  } catch (error) {
    throw socksFailure(error instanceof Error ? error.message : String(error));
  }
  if (options.signal?.aborted === true) {
    // The package takes no signal: a caller that gave up meanwhile is told
    // so, and the tunnel it no longer wants is closed.
    connection.socket.destroy();
    throw options.signal.reason;
  }
  return { socket: connection.socket, head: Buffer.alloc(0) };
}

/**
 * Open a tunnel to `host:port` through `upstream`. Fails with a
 * {@link ProxyTunnelError}, or with the signal's reason. The caller owns the
 * socket: it listens for its errors and closes it.
 */
export async function openProxyTunnel(
  upstream: VideoProxyUpstream,
  host: string,
  port: number,
  options: OpenTunnelOptions,
): Promise<ProxyTunnel> {
  if (options.signal?.aborted === true) throw options.signal.reason;
  return upstream.scheme === 'http' || upstream.scheme === 'https'
    ? await httpTunnel(upstream, host, port, options)
    : await socksTunnel(upstream, host, port, options);
}
