// Connections to an upstream proxy, and raw tunnels through it, for the bridge.
//
// A browser's CONNECT needs a plain byte tunnel, which no HTTP client library
// gives, so the bridge opens it here:
//
// * `socks5`: SOCKS5 CONNECT with RFC 1929 username/password (the `socks`
//   package). Host names reach the proxy unresolved (remote DNS).
// * `http`: `CONNECT host:port` with `Proxy-Authorization: Basic`.
// * `https`: the same over TLS to the proxy itself (certificate verified).
//
// `openUpstream` is the connection to the proxy alone, for plain-HTTP requests
// that an HTTP proxy forwards itself (absolute-form).

import { Buffer } from 'node:buffer';
import net from 'node:net';
import tls from 'node:tls';
import { domainToASCII } from 'node:url';

import { SocksClient, SocksClientError } from 'socks';

import { isRecord } from '../../../lib/is-record.ts';
import { debugLog } from '../../lib/debug.ts';
import { errorText } from '../../lib/error-text.ts';
import {
  HeadError,
  endToEnd,
  headBytes,
  hostAndPort,
  parseStatusLine,
  readHead,
  splitHead,
} from './http-head.ts';
import type { Header } from './http-head.ts';
import { hasAuth } from './types.ts';
import type { ProxyConfig } from './types.ts';

const debug = debugLog('proxies');

/** Trust anchors for TLS; the runtime's own trust store when left out. */
export type TrustAnchors = tls.ConnectionOptions['ca'];

const CREDENTIALS_REJECTED = 'the upstream proxy rejected the credentials';
const CLOSED =
  'the upstream proxy closed the connection or sent an invalid answer';
const NOT_IN_TIME = 'the upstream proxy did not answer in time';
const NO_METHOD =
  'the upstream SOCKS5 proxy accepted none of the offered authentication methods';

export type UpstreamErrorKind =
  /** The proxy rejected the credentials. */
  | 'auth'
  /** The proxy did not answer in time. */
  | 'timeout'
  /** The proxy itself could not be used: refused, unreachable, TLS failed, not the right protocol. */
  | 'connect'
  /** The proxy works but did not carry this one request: the tunnel was refused or broke down. */
  | 'tunnel';

/**
 * The upstream did not carry the request. `message` is for the browser behind
 * the bridge and never contains a password.
 */
export class UpstreamError extends Error {
  readonly kind: UpstreamErrorKind;
  /** What the bridge answers the browser: 504 for a timeout, else 502 or the proxy's own error status. */
  readonly status: number;

  constructor(kind: UpstreamErrorKind, status: number, message: string) {
    super(message);
    this.name = 'UpstreamError';
    this.kind = kind;
    this.status = status;
  }
}

export interface OpenOptions {
  /** Bounds the connection to the proxy alone: TCP and, for `https`, TLS. */
  connectTimeoutMs?: number;
  /** Bounds everything up to an open tunnel: connect, TLS, handshake, the proxy's answer. */
  timeoutMs?: number;
  /** Cancels the attempt; it then fails with the signal's reason. */
  signal?: AbortSignal;
  /** Trust anchors to verify an `https` proxy with. For tests; the default is the runtime's. */
  ca?: TrustAnchors;
  /** End-to-end headers to send with an HTTP `CONNECT` (the bridge passes the browser's on). */
  headers?: readonly Header[];
}

/** `Proxy-Authorization: Basic ...` for an HTTP(S) proxy with credentials, else `null`. */
export function proxyAuthorization(upstream: ProxyConfig): string | null {
  if (!hasAuth(upstream) || upstream.scheme === 'socks5') return null;
  const token = Buffer.from(
    `${upstream.username}:${upstream.password ?? ''}`,
  ).toString('base64');
  return `Proxy-Authorization: Basic ${token}`;
}

/**
 * Destroys the socket when the time is up or the signal fires, so that whatever
 * waits on the socket fails; `reason` says why it was destroyed.
 */
class Watchdog {
  reason: 'timeout' | 'abort' | null = null;
  private readonly timer: ReturnType<typeof setTimeout> | undefined;
  private readonly onAbort = () => this.trip('abort');

  constructor(
    private readonly socket: net.Socket,
    ms: number | undefined,
    private readonly signal: AbortSignal | undefined,
  ) {
    if (ms !== undefined && Number.isFinite(ms)) {
      this.timer = setTimeout(() => this.trip('timeout'), Math.max(0, ms));
    }
    if (signal?.aborted) this.trip('abort');
    else signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  private trip(reason: 'timeout' | 'abort'): void {
    if (this.reason !== null) return;
    this.reason = reason;
    this.socket.destroy();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.signal?.removeEventListener('abort', this.onAbort);
  }

  /** The error to throw instead of the socket's own when the watchdog destroyed it. */
  replacement(): unknown {
    if (this.reason === 'abort')
      return this.signal?.reason ?? new Error('aborted');
    if (this.reason === 'timeout')
      return new UpstreamError('timeout', 504, NOT_IN_TIME);
    return undefined;
  }
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** Failures of the TCP connection itself (refused, unreachable, no such host). */
function isTcpError(error: unknown): boolean {
  return (
    isRecord(error) &&
    (error.syscall === 'connect' || error.syscall === 'getaddrinfo')
  );
}

/** A socket error before or while the connection to the proxy is made. Exported for the tests of its cases. */
export function connectFailure(
  error: unknown,
  tlsStage: boolean,
): UpstreamError {
  const code = errorCode(error);
  if (tlsStage) {
    // Once TCP is up, what goes wrong is the handshake (an untrusted certificate, a proxy that
    // does not speak TLS); a reset in that stage is the proxy hanging up on it.
    const detail =
      code === 'ECONNRESET' || code === undefined
        ? 'the connection was closed during the handshake'
        : errorText(error);
    return new UpstreamError(
      'connect',
      502,
      `TLS connection to the upstream proxy failed (${detail})`,
    );
  }
  switch (code) {
    case 'ECONNREFUSED':
      return new UpstreamError(
        'connect',
        502,
        'the upstream proxy refused the connection',
      );
    case 'ETIMEDOUT':
      return new UpstreamError('timeout', 504, NOT_IN_TIME);
    case 'ECONNRESET':
    case 'EPIPE':
    case 'ECONNABORTED':
      return new UpstreamError('connect', 502, CLOSED);
    default:
      // Unknown host name, no route, ...
      return new UpstreamError(
        'connect',
        502,
        'cannot reach the upstream proxy',
      );
  }
}

function socketReady(
  socket: net.Socket,
  event: 'connect' | 'secureConnect',
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off(event, onReady);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    function onReady() {
      cleanup();
      resolve();
    }
    function onError(error: Error) {
      cleanup();
      reject(error);
    }
    function onClose() {
      cleanup();
      reject(new Error('connection closed'));
    }
    socket.once(event, onReady);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function ignoreSocketError(error: Error): void {
  // An error destroys the socket and 'close' follows; whoever owns the socket reacts to that.
  // The listener only keeps the runtime from throwing the error as uncaught.
  debug(`upstream socket error: ${error.message}`);
}

/** A connection to the proxy itself (TCP, plus TLS for `https`), within `ms`. */
async function connectToProxy(
  upstream: ProxyConfig,
  ms: number | undefined,
  signal: AbortSignal | undefined,
  ca: TrustAnchors,
): Promise<net.Socket> {
  const secure = upstream.scheme === 'https';
  // Half-closes are relayed, not turned into a full close.
  const socket = secure
    ? tls.connect({
        host: upstream.host,
        port: upstream.port,
        // An IP address is not a server name (RFC 6066); it is checked against the certificate's IP names.
        servername: net.isIP(upstream.host) === 0 ? upstream.host : undefined,
        ca,
        allowHalfOpen: true,
      })
    : net.connect({
        host: upstream.host,
        port: upstream.port,
        allowHalfOpen: true,
      });
  socket.on('error', ignoreSocketError);
  let tcpConnected = false;
  socket.once('connect', () => {
    tcpConnected = true;
    socket.setNoDelay(true);
  });
  const watchdog = new Watchdog(socket, ms, signal);
  try {
    await socketReady(socket, secure ? 'secureConnect' : 'connect');
    return socket;
  } catch (error) {
    socket.destroy();
    throw (
      watchdog.replacement() ??
      connectFailure(error, secure && (tcpConnected || !isTcpError(error)))
    );
  } finally {
    watchdog.stop();
  }
}

/**
 * A connection to the upstream proxy, ready for a request to the proxy itself.
 * The caller owns the socket and must listen for its 'error' events. Fails with
 * an `UpstreamError`, or with the signal's reason.
 */
export async function openUpstream(
  upstream: ProxyConfig,
  options: OpenOptions = {},
): Promise<net.Socket> {
  const ms = Math.min(
    options.connectTimeoutMs ?? Infinity,
    options.timeoutMs ?? Infinity,
  );
  return connectToProxy(
    upstream,
    Number.isFinite(ms) ? ms : undefined,
    options.signal,
    options.ca,
  );
}

/**
 * A connection to `host:port` through the upstream proxy.
 *
 * The socket comes back paused, with anything the proxy sent after its answer
 * pushed back: attach a listener and resume it in one step (`pipe()` does). The
 * caller owns the socket and must listen for its 'error' events. Fails with an
 * `UpstreamError`, or with the signal's reason.
 */
export async function openTunnel(
  upstream: ProxyConfig,
  host: string,
  port: number,
  options: OpenOptions = {},
): Promise<net.Socket> {
  const started = performance.now();
  const remaining = () =>
    options.timeoutMs === undefined
      ? undefined
      : options.timeoutMs - (performance.now() - started);
  const connectMs = Math.min(
    options.connectTimeoutMs ?? Infinity,
    remaining() ?? Infinity,
  );

  const target = wireHost(host);
  const socket = await connectToProxy(
    upstream,
    Number.isFinite(connectMs) ? connectMs : undefined,
    options.signal,
    options.ca,
  );
  const watchdog = new Watchdog(socket, remaining(), options.signal);
  try {
    if (upstream.scheme === 'socks5') {
      await socks5Connect(socket, upstream, target, port, remaining());
    } else {
      await httpConnect(socket, upstream, target, port, options.headers ?? []);
    }
    return socket;
  } catch (error) {
    socket.destroy();
    throw watchdog.replacement() ?? tunnelFailure(error);
  } finally {
    watchdog.stop();
  }
}

/** The host as the proxy gets it: ASCII (punycode), with no way to smuggle in a line break. */
function wireHost(host: string): string {
  const ascii = /^[\u0000-\u007f]*$/.test(host) ? host : domainToASCII(host);
  if (ascii === '' || /[\u0000-\u0020\u007f]/.test(ascii)) {
    throw new UpstreamError('tunnel', 502, 'the target host name is invalid');
  }
  return ascii;
}

/** A failure while the tunnel is being set up. Exported for the tests of its cases. */
export function tunnelFailure(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) return error;
  if (error instanceof SocksClientError) return socksFailure(error.message);
  if (error instanceof HeadError)
    return new UpstreamError('tunnel', 502, CLOSED);
  const code = errorCode(error);
  if (code === 'ETIMEDOUT')
    return new UpstreamError('timeout', 504, NOT_IN_TIME);
  if (code !== undefined) return new UpstreamError('tunnel', 502, CLOSED);
  // Not a network error: a bug. Do not hide it behind a plausible message.
  throw error;
}

async function httpConnect(
  socket: net.Socket,
  upstream: ProxyConfig,
  host: string,
  port: number,
  headers: readonly Header[],
): Promise<void> {
  const target = hostAndPort(host, port);
  const lines = [`CONNECT ${target} HTTP/1.1`, `Host: ${target}`];
  for (const [name, value] of endToEnd(headers)) {
    if (name.toLowerCase() !== 'host') lines.push(`${name}: ${value}`);
  }
  const authorization = proxyAuthorization(upstream);
  if (authorization !== null) lines.push(authorization);
  socket.write(headBytes(lines));

  const { startLine } = splitHead(await readHead(socket));
  const { status, reason } = parseStatusLine(startLine);
  if (status === 407) {
    throw new UpstreamError('auth', 502, `${CREDENTIALS_REJECTED} (HTTP 407)`);
  }
  if (status < 200 || status >= 300) {
    throw new UpstreamError(
      'tunnel',
      status >= 400 && status < 600 ? status : 502,
      `the upstream proxy refused the tunnel: ${status} ${reason}`.trim(),
    );
  }
}

// What the SOCKS5 server's refusal to connect means (RFC 1928, section 6). The names are the
// `socks` package's. A TTL that expired is a timeout, like for the browser's own SOCKS client.
const SOCKS_REPLIES: ReadonlyMap<string, { text: string; status: number }> =
  new Map([
    ['Failure', { text: 'general SOCKS server failure', status: 502 }],
    ['NotAllowed', { text: 'connection not allowed by ruleset', status: 502 }],
    ['NetworkUnreachable', { text: 'network unreachable', status: 502 }],
    ['HostUnreachable', { text: 'host unreachable', status: 502 }],
    ['ConnectionRefused', { text: 'connection refused', status: 502 }],
    ['TTLExpired', { text: 'TTL expired', status: 504 }],
    ['CommandNotSupported', { text: 'command not supported', status: 502 }],
    [
      'AddressNotSupported',
      { text: 'address type not supported', status: 502 },
    ],
  ]);

/** The `socks` package reports its failures as text only. */
function socksFailure(message: string, target = 'the target'): UpstreamError {
  const refused = /^Socks5 proxy rejected connection - (\w+)$/.exec(message);
  if (refused) {
    const reply = SOCKS_REPLIES.get(refused[1] ?? '') ?? {
      text: 'unknown reply',
      status: 502,
    };
    return new UpstreamError(
      'tunnel',
      reply.status,
      `the upstream proxy could not connect to ${target}: ${reply.text}`,
    );
  }
  if (message === 'Socks5 Authentication failed') {
    return new UpstreamError('auth', 502, CREDENTIALS_REJECTED);
  }
  if (
    /no accepted authentication type|unknown authentication type/.test(message)
  ) {
    return new UpstreamError('auth', 502, NO_METHOD);
  }
  if (/invalid socks version/.test(message)) {
    return new UpstreamError(
      'connect',
      502,
      'the upstream proxy is not a SOCKS5 proxy',
    );
  }
  if (/timed out/.test(message))
    return new UpstreamError('timeout', 504, NOT_IN_TIME);
  return new UpstreamError('tunnel', 502, CLOSED);
}

async function socks5Connect(
  socket: net.Socket,
  upstream: ProxyConfig,
  host: string,
  port: number,
  ms: number | undefined,
): Promise<void> {
  const username = upstream.username;
  const password = upstream.password ?? '';
  // The package writes the length as one byte and would throw from inside a socket event.
  if (
    username !== null &&
    (Buffer.byteLength(username) > 255 || Buffer.byteLength(password) > 255)
  ) {
    throw new UpstreamError(
      'auth',
      502,
      'the upstream SOCKS5 username or password is longer than 255 bytes',
    );
  }
  if (Buffer.byteLength(host) > 255) {
    throw new UpstreamError('tunnel', 502, 'the target host name is too long');
  }
  try {
    await SocksClient.createConnection({
      command: 'connect',
      // A name stays a name: the proxy resolves it.
      destination: { host, port },
      proxy: {
        host: upstream.host,
        port: upstream.port,
        type: 5,
        ...(username === null ? {} : { userId: username, password }),
      },
      timeout: ms === undefined ? undefined : Math.max(1, Math.ceil(ms)),
      existing_socket: socket,
    });
  } catch (error) {
    if (error instanceof SocksClientError)
      throw socksFailure(error.message, hostAndPort(host, port));
    throw error;
  }
  // The package pauses the socket, then one tick later resumes it and replays what the proxy sent
  // right after its answer. Collect all that, so that the caller gets the state an HTTP tunnel
  // has: paused, with those bytes pushed back.
  const early: Buffer[] = [];
  const collect = (chunk: Buffer) => early.push(chunk);
  socket.on('data', collect);
  await new Promise<void>((resolve) => setImmediate(resolve));
  socket.off('data', collect);
  socket.pause();
  if (early.length > 0) socket.unshift(Buffer.concat(early));
}
