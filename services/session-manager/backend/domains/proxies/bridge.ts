// Local, credential-free HTTP proxy in front of an upstream proxy that needs credentials.
//
// The browser is never given proxy credentials:
//
// * Firefox refuses SOCKS5 credentials ("Browser does not support socks5 proxy
//   authentication").
// * With an authenticated HTTP(S) proxy, Playwright answers the proxy's 407
//   challenge for page requests only, so Firefox's background requests (update
//   checks, filter lists) are refused with 407 over and over.
//
// Instead, each session's browser talks to its own bridge on 127.0.0.1 (random
// port, no authentication). The bridge sends every CONNECT and plain-HTTP
// (absolute-form) request through the upstream proxy with the upstream's
// credentials:
//
// * `socks5`: SOCKS5 CONNECT with RFC 1929 username/password. Host names reach
//   the proxy unresolved (remote DNS).
// * `http`: `CONNECT host:port` and absolute-form requests with
//   `Proxy-Authorization: Basic`.
// * `https`: the same over TLS to the proxy (certificate verified).
//
// Any local process can use the port while the bridge runs (see the README).
//
//     const bridge = await ProxyBridge.start(parseProxy('http://user:pass@gate.example.com:8080'));
//     launch({ proxy: bridge.playwrightProxy });
//     await bridge.close();

import { Buffer } from 'node:buffer';
import { STATUS_CODES } from 'node:http';
import net from 'node:net';

import { debugLog } from '../../lib/debug.ts';
import { errorText } from '../../lib/error-text.ts';
import {
  UpstreamError,
  openTunnel,
  openUpstream,
  proxyAuthorization,
} from './connect.ts';
import type { TrustAnchors } from './connect.ts';
import {
  HEAD_LIMIT,
  HeadError,
  endToEnd,
  headBytes,
  hostAndPort,
  parseHeaders,
  parseStatusLine,
  readHead,
  splitHead,
} from './http-head.ts';
import type { Header } from './http-head.ts';
import { displayOf } from './types.ts';
import type { ProxyConfig, RunningBridge } from './types.ts';

const debug = debugLog('proxies');

const CLOSE_TIMEOUT_MS = 5000;
/**
 * How long a browser gets to send the head of a request (a browser sends it at
 * once). Only the head: a tunnel that is up carries long-lived connections (a
 * WebSocket is silent for minutes) and is never timed out.
 */
export const HEAD_TIMEOUT_MS = 30_000;
const UPSTREAM_SCHEMES = new Set(['http', 'https', 'socks5']);

export interface ProxyBridgeOptions {
  /**
   * Bounds everything up to an open tunnel: TCP, TLS, the SOCKS5 handshake, the
   * upstream's CONNECT answer. Default 30 s.
   */
  connectTimeoutMs?: number;
  /** How long a client gets to send the head of its request. Default `HEAD_TIMEOUT_MS`. */
  headTimeoutMs?: number;
  /** Trust anchors to verify an `https` upstream with. For tests; the default is the runtime's. */
  ca?: TrustAnchors;
  /**
   * Called with one line for every request the upstream did not carry (the
   * upstream is named without its password). Default: `console.info`.
   */
  log?: (line: string) => void;
}

/** What a browser asked the bridge for. */
interface BridgeRequest {
  method: string;
  /** `host:port` (CONNECT) or the absolute http:// URL. */
  target: string;
  version: string;
  headers: Header[];
  host: string;
  port: number;
  isConnect: boolean;
}

export class ProxyBridge implements RunningBridge {
  readonly upstream: ProxyConfig;

  private readonly connectTimeoutMs: number;
  private readonly headTimeoutMs: number;
  private readonly ca: TrustAnchors;
  private readonly log: (line: string) => void;
  private readonly server: net.Server;
  private readonly sockets = new Set<net.Socket>();
  /**
   * The connections being made to the upstream, to abort when the bridge
   * closes. One controller each: a signal shared by all would collect a listener
   * per connection.
   */
  private readonly connecting = new Set<AbortController>();
  private closed: Promise<void> | undefined;
  private boundPort = 0;

  private constructor(upstream: ProxyConfig, options: ProxyBridgeOptions) {
    this.upstream = upstream;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 30_000;
    this.headTimeoutMs = options.headTimeoutMs ?? HEAD_TIMEOUT_MS;
    this.ca = options.ca;
    this.log = options.log ?? ((line) => console.info(line));
    this.server = net.createServer({ allowHalfOpen: true }, (client) =>
      this.accept(client),
    );
  }

  /** Listen on 127.0.0.1, on a port the system picks. */
  static async start(
    upstream: ProxyConfig,
    options: ProxyBridgeOptions = {},
  ): Promise<ProxyBridge> {
    if (!UPSTREAM_SCHEMES.has(upstream.scheme)) {
      throw new Error(`unsupported upstream proxy scheme '${upstream.scheme}'`);
    }
    const bridge = new ProxyBridge(upstream, options);
    await new Promise<void>((resolve, reject) => {
      bridge.server.once('error', reject);
      bridge.server.listen(0, '127.0.0.1', () => {
        bridge.server.off('error', reject);
        resolve();
      });
    });
    const address = bridge.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('the proxy bridge did not bind a port');
    }
    bridge.boundPort = address.port;
    bridge.server.on('error', (error) =>
      console.error('proxy bridge server failed:', error),
    );
    return bridge;
  }

  get port(): number {
    return this.boundPort;
  }

  /** The browser's proxy setting: the bridge, without credentials. */
  get playwrightProxy(): { server: string } {
    return { server: `http://127.0.0.1:${this.boundPort}` };
  }

  /** Stop listening and close every connection, the half-made ones too. */
  close(): Promise<void> {
    this.closed ??= this.shutDown();
    return this.closed;
  }

  private async shutDown(): Promise<void> {
    for (const attempt of this.connecting) {
      attempt.abort(new Error('the proxy bridge was closed'));
    }
    const stopped = new Promise<void>((resolve) =>
      this.server.close(() => resolve()),
    );
    for (const socket of this.sockets) socket.destroy();
    // A connection that does not close must not hang the caller.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, CLOSE_TIMEOUT_MS);
    });
    await Promise.race([stopped, timeout]);
    clearTimeout(timer);
  }

  private track(socket: net.Socket): void {
    this.sockets.add(socket);
    socket.once('close', () => this.sockets.delete(socket));
  }

  private accept(client: net.Socket): void {
    this.track(client);
    // The browser resetting a connection is normal; 'close' follows. Without a listener the
    // runtime would throw the error as uncaught.
    client.on('error', (error) =>
      debug(`client socket error: ${error.message}`),
    );
    client.setNoDelay(true);
    this.serve(client).catch((error: unknown) => {
      console.error('proxy bridge handler failed:', error);
      client.destroy();
    });
  }

  private async serve(client: net.Socket): Promise<void> {
    let head: string;
    try {
      head = await readHead(client, HEAD_LIMIT, this.headTimeoutMs);
    } catch (error) {
      // The browser closed, sent more than a head can be, or sent too little
      // for too long.
      debug(`request not read: ${errorText(error)}`);
      client.destroy();
      return;
    }
    let request: BridgeRequest;
    try {
      request = parseRequest(head);
    } catch (error) {
      if (!(error instanceof HeadError)) throw error;
      debug(`malformed request: ${error.message}`);
      respond(client, 400, 'malformed proxy request');
      return;
    }

    let upstream: net.Socket;
    try {
      upstream = await this.open(request);
    } catch (error) {
      if (this.closed !== undefined) {
        client.destroy();
        return;
      }
      const failure = failureOf(error);
      // Where the browser was going is where a person browses: not in a log
      // that is always on, only in the debug lines (`DEBUG=session-manager`).
      const via = displayOf(this.upstream);
      debug(
        `${request.method} ${hostAndPort(request.host, request.port)} via ${via} failed: ${failure.message}`,
      );
      this.log(
        `proxy bridge: ${request.method} via ${via} failed: ${failure.message}`,
      );
      respond(client, failure.status, failure.message);
      return;
    }
    this.track(upstream);
    upstream.on('error', (error) =>
      debug(`upstream socket error: ${error.message}`),
    );
    if (this.closed !== undefined || client.destroyed) {
      upstream.destroy();
      return;
    }

    if (request.isConnect) {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      relay(client, upstream, true);
      return;
    }
    upstream.write(this.requestHead(request));
    // The body, and the end of it as a half-close: the response is still to come.
    client.pipe(upstream);
    const clientGone = () => upstream.destroy();
    client.once('close', clientGone);
    try {
      await forwardResponseHead(upstream, client);
    } catch (error) {
      client.off('close', clientGone);
      client.unpipe(upstream);
      upstream.destroy();
      if (client.destroyed) return; // the browser left, so there is nobody to tell
      const failure = failureOf(error);
      this.log(`proxy bridge: plain HTTP request failed: ${failure.message}`);
      respond(client, failure.status, failure.message);
      return;
    }
    client.off('close', clientGone);
    relay(client, upstream, false);
  }

  /**
   * A connection to the upstream that is ready for the request: a tunnel to the
   * target for CONNECT and for SOCKS5, else a connection to the HTTP proxy itself.
   */
  private async open(request: BridgeRequest): Promise<net.Socket> {
    const attempt = new AbortController();
    this.connecting.add(attempt);
    const options = {
      timeoutMs: this.connectTimeoutMs,
      signal: attempt.signal,
      ca: this.ca,
      headers: request.headers,
    };
    try {
      if (this.upstream.scheme === 'socks5' || request.isConnect) {
        return await openTunnel(
          this.upstream,
          request.host,
          request.port,
          options,
        );
      }
      return await openUpstream(this.upstream, options);
    } finally {
      this.connecting.delete(attempt);
    }
  }

  /**
   * The plain-HTTP request for the upstream: absolute-form with the upstream's
   * credentials for an HTTP proxy, origin-form for the origin server at the end
   * of a SOCKS5 tunnel. One request per upstream connection.
   */
  private requestHead(request: BridgeRequest): Buffer {
    const extra: string[] = [];
    let target: string;
    if (this.upstream.scheme === 'socks5') {
      target = originForm(request.target);
    } else {
      target = request.target;
      const authorization = proxyAuthorization(this.upstream);
      if (authorization !== null) extra.push(authorization);
    }
    return headBytes([
      `${request.method} ${target} ${request.version}`,
      ...endToEnd(request.headers).map(([name, value]) => `${name}: ${value}`),
      ...extra,
      'Connection: close',
    ]);
  }
}

/** Status and message for the browser when the upstream could not be used. */
function failureOf(error: unknown): { status: number; message: string } {
  if (error instanceof UpstreamError)
    return { status: error.status, message: error.message };
  // Not a failure of the upstream: a bug. Say so in the log, not to the browser.
  console.error('proxy bridge failed:', error);
  return {
    status: 502,
    message: 'the proxy bridge failed to use the upstream proxy',
  };
}

/** `/path?query` of an absolute http:// URL (the fragment is not sent). */
function originForm(target: string): string {
  const rest = /^http:\/\/[^/?#]*([^#]*)/i.exec(target)?.[1] ?? '';
  if (rest === '') return '/';
  return rest.startsWith('?') ? `/${rest}` : rest;
}

/** Throws `HeadError` (with a message that starts with "invalid") for anything but a CONNECT or an absolute-form http:// request. */
function parseRequest(head: string): BridgeRequest {
  const { startLine, lines } = splitHead(head);
  const parts = startLine.split(' ');
  const [method, target, version] = parts;
  if (
    parts.length !== 3 ||
    method === undefined ||
    target === undefined ||
    version === undefined ||
    !/^HTTP\/\d(?:\.\d)?$/.test(version)
  ) {
    throw new HeadError('invalid request line');
  }
  const headers = parseHeaders(lines);
  const isConnect = method.toUpperCase() === 'CONNECT';
  let host: string;
  let portText: string;
  if (isConnect) {
    const colon = target.lastIndexOf(':');
    const rawHost = colon < 0 ? '' : target.slice(0, colon);
    host =
      rawHost.startsWith('[') && rawHost.endsWith(']')
        ? rawHost.slice(1, -1)
        : rawHost;
    portText = colon < 0 ? target : target.slice(colon + 1);
    if (!/^[0-9]+$/.test(portText)) throw new HeadError('invalid CONNECT port');
  } else {
    const match = /^http:\/\/([^/?#]*)/i.exec(target);
    if (match === null)
      throw new HeadError('invalid target: not an absolute http:// URL');
    // The user info is not sent on; the host is case-insensitive.
    const authority = (match[1] ?? '').slice(
      (match[1] ?? '').lastIndexOf('@') + 1,
    );
    if (authority.startsWith('[')) {
      const end = authority.indexOf(']');
      const after = authority.slice(end + 1);
      if (end < 0 || (after !== '' && !after.startsWith(':'))) {
        throw new HeadError('invalid target: bad IPv6 address');
      }
      host = authority.slice(1, end).toLowerCase();
      portText = after.slice(1);
    } else {
      const colon = authority.indexOf(':');
      host = (colon < 0 ? authority : authority.slice(0, colon)).toLowerCase();
      portText = colon < 0 ? '' : authority.slice(colon + 1);
    }
    if (portText === '') portText = '80';
    if (!/^[0-9]+$/.test(portText))
      throw new HeadError('invalid target: bad port');
  }
  const port = Number.parseInt(portText, 10);
  if (host === '' || !(port > 0 && port < 65536))
    throw new HeadError('invalid target');
  return { method, target, version, headers, host, port, isConnect };
}

/** Answer the browser with an error page and let go of it. */
function respond(client: net.Socket, status: number, message: string): void {
  if (client.destroyed) return;
  const phrase = STATUS_CODES[status] ?? 'Error';
  const body = Buffer.from(`${status} ${phrase}: ${message}\n`);
  const head = headBytes([
    `HTTP/1.1 ${status} ${phrase}`,
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${body.length}`,
    'Connection: close',
  ]);
  client.end(Buffer.concat([head, body]));
  // Read what the browser still sends, so that its closing is noticed.
  client.resume();
}

/**
 * Pass the upstream's response head on, with `Connection: close` (one request
 * per connection). A 407 never reaches the browser: it would only ask for
 * credentials again.
 */
async function forwardResponseHead(
  upstream: net.Socket,
  client: net.Socket,
): Promise<void> {
  for (;;) {
    let head: string;
    let startLine: string;
    let lines: string[];
    let status: number;
    try {
      head = await readHead(upstream, HEAD_LIMIT);
      ({ startLine, lines } = splitHead(head));
      ({ status } = parseStatusLine(startLine));
    } catch (error) {
      if (!(error instanceof HeadError) && !isSocketError(error)) throw error;
      throw new UpstreamError(
        'tunnel',
        502,
        'the upstream closed the connection or sent an invalid response',
      );
    }
    if (status === 407) {
      throw new UpstreamError(
        'auth',
        502,
        'the upstream proxy rejected the credentials (HTTP 407)',
      );
    }
    if (status >= 100 && status < 200 && status !== 101) {
      client.write(Buffer.from(head, 'latin1')); // an interim response: the final one follows
      continue;
    }
    const kept = endToEnd(parseHeaders(lines)).map(
      ([name, value]) => `${name}: ${value}`,
    );
    client.write(headBytes([startLine, ...kept, 'Connection: close']));
    return;
  }
}

function isSocketError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error;
}

/**
 * Copy bytes both ways until the upstream side closes (or the browser aborts).
 * A half-close is passed on: the browser finishing its request does not end the
 * response. `upload` is false when the browser's side already feeds the upstream.
 */
function relay(
  client: net.Socket,
  upstream: net.Socket,
  upload: boolean,
): void {
  const teardown = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', teardown);
  upstream.on('error', teardown);
  // One side gone for good: the other has nobody to talk to.
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
  if (upload) client.pipe(upstream);
  upstream.pipe(client);
}
