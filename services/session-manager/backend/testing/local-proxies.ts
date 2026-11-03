// Tiny in-process proxies for tests.
//
// * `HttpProxy`   - HTTP/1.1 forward proxy: absolute-form requests (plain http://)
//                   and `CONNECT host:port` tunnels (https://, wss://, ...); optional
//                   Basic `Proxy-Authorization` and optional TLS to the proxy itself
//                   (an https:// proxy: pass `tls: await selfSignedCertificate()`).
// * `Socks5Proxy` - SOCKS5 (RFC 1928) CONNECT, optional RFC 1929 user/pass auth.
//
// Both listen on 127.0.0.1 with a random port, record every request / tunnel in
// `proxy.events`, and stop with `stop()`:
//
//     const proxy = await new HttpProxy({ username: 'u', password: 'p' }).start();
//     afterEach(() => proxy.stop());
//     const browserProxy = proxy.playwrightProxy; // { server: 'http://127.0.0.1:PORT', username, password }
//     expect(proxy.saw('api.ipify.org', 443, { kind: 'CONNECT' })).toBe(true);
//
// `hosts` maps host names to addresses the proxy connects to instead (like
// /etc/hosts): `{ 'shop.test': '127.0.0.1' }` routes a fake domain to a local
// test server, and the name reaches the proxy unresolved, as with a real one.
//
// Plain-HTTP forwarding handles one request per client connection (the request
// to the origin is sent with `Connection: close`); that is enough for browsers
// and HTTP clients, which reconnect on their own.
//
// Around them, what a test of a proxy needs:
//
// * `selfSignedCertificate()` - a throw-away certificate made in process (no
//   openssl, no files); it is its own trust anchor, give it to the client as `ca`.
// * `startTcpServer(onConnection)`, `startOrigin(respond?)`, `closedPort()`,
//   `portOf(server)` - the servers a proxy connects to, and a port that refuses
//   (held until the test that asked for it ends).
// * `rawHttp`, `connectThrough`, `readAll`, `SocketReader` - clients that talk
//   to a proxy by hand, so a test controls every byte.
//
// `proxy.connections` counts the client connections still open, for tests that
// a client let go of its connections.

import { Buffer } from 'node:buffer';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

import * as x509 from '@peculiar/x509';
import { onTestFinished } from 'vitest';

import { debugLog } from '../lib/debug.ts';
import { errorText } from '../lib/error-text.ts';

const debug = debugLog('local-proxies');

// Transfer-Encoding is kept: the body is relayed byte-for-byte, still chunked.
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'upgrade',
]);
const CRLF2 = Buffer.from('\r\n\r\n');
const STOP_TIMEOUT_MS = 5000;

export type ProxyEventKind =
  /** An absolute-form request (plain http://). */
  | 'HTTP'
  | 'CONNECT'
  | 'SOCKS5'
  /** A SOCKS5 authentication failure. */
  | 'AUTH';

/** One request / tunnel seen by a proxy. */
export interface ProxyEvent {
  kind: ProxyEventKind;
  /** HTTP method, `CONNECT`, or the SOCKS command name. */
  method: string;
  /** The absolute URL (HTTP) or `host:port` (CONNECT / SOCKS5). */
  target: string;
  /** The target host as the client sent it (a name means: resolved by the proxy). */
  host: string;
  port: number;
  /** The HTTP status answered (200/400/407/502/504) or the SOCKS REP code (0 = ok). */
  status: number;
  /** `ip:port` of the client. */
  client: string;
  /** The username the client presented (even if wrong), else `null`. */
  username: string | null;
  /** SOCKS5 address type of the target. */
  addrType: 'domain' | 'ipv4' | 'ipv6' | null;
  timestamp: number;
  /** The proxy carried it: HTTP status below 400, SOCKS reply 0. */
  ok: boolean;
}

export interface LocalProxyOptions {
  host?: string;
  /** Default 0: a random free port. */
  port?: number;
  /** Both or neither. */
  username?: string;
  password?: string;
  /** How long the proxy waits for the target. Default 10 s. */
  connectTimeoutMs?: number;
  hosts?: Readonly<Record<string, string>>;
  onEvent?: (event: ProxyEvent) => void;
}

export interface HttpProxyOptions extends LocalProxyOptions {
  /** Talk TLS to the clients (an https:// proxy). */
  tls?: SelfSignedCertificate;
}

/** The end of the input came before the reader had what it needed. */
class EndOfStream extends Error {}

/** Percent-encode everything but letters, digits and `_.-~`, as a URL's user info needs. */
function quote(text: string): string {
  return encodeURIComponent(text).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function formatHostPort(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

function describePeer(socket: net.Socket): string {
  return formatHostPort(socket.remoteAddress ?? '?', socket.remotePort ?? 0);
}

/**
 * Buffers a socket's input so that a handler (or a test speaking a protocol by
 * hand) can read it in steps. `release()` hands back what was not used.
 */
export class SocketReader {
  private buffer: Buffer = Buffer.alloc(0);
  private ended = false;
  private wake: (() => void) | null = null;

  constructor(private readonly socket: net.Socket) {
    socket.on('data', this.onData);
    socket.on('end', this.onEnd);
    socket.on('close', this.onEnd);
    socket.resume();
  }

  private readonly onData = (chunk: Buffer) => {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.notify();
  };
  private readonly onEnd = () => {
    this.ended = true;
    this.notify();
  };

  private notify(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private async more(): Promise<void> {
    if (this.ended) throw new EndOfStream();
    await new Promise<void>((resolve) => {
      this.wake = resolve;
    });
  }

  /** Up to and including `delimiter`. */
  async readUntil(delimiter: Buffer, limit = 64 * 1024): Promise<Buffer> {
    for (;;) {
      const at = this.buffer.indexOf(delimiter);
      if (at >= 0) return this.take(at + delimiter.length);
      if (this.buffer.length > limit) throw new EndOfStream();
      await this.more();
    }
  }

  async readExactly(length: number): Promise<Buffer> {
    while (this.buffer.length < length) await this.more();
    return this.take(length);
  }

  /** Everything up to the end of the input (the peer closed or half-closed). */
  async readToEnd(timeoutMs = 5000): Promise<Buffer> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`no end of input within ${timeoutMs} ms`)),
        timeoutMs,
      );
    });
    const ended = (async () => {
      while (!this.ended) await this.more();
      return this.take(this.buffer.length);
    })();
    try {
      return await Promise.race([ended, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private take(length: number): Buffer {
    const taken = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return taken;
  }

  /** Stop reading; the socket is left paused and the unused input is returned. */
  release(): Buffer {
    this.socket.off('data', this.onData);
    this.socket.off('end', this.onEnd);
    this.socket.off('close', this.onEnd);
    this.socket.pause();
    const rest = this.buffer;
    this.buffer = Buffer.alloc(0);
    return rest;
  }
}

/** Copy bytes both ways until both sides are done; a half-close is passed on. */
function relay(
  client: net.Socket,
  upstream: net.Socket,
  early: Buffer,
): Promise<void> {
  const closed = (socket: net.Socket) =>
    new Promise<void>((resolve) => {
      if (socket.destroyed) resolve();
      else socket.once('close', () => resolve());
    });
  const finished = Promise.all([closed(client), closed(upstream)]);
  const teardown = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', teardown);
  upstream.on('error', teardown);
  // One side gone for good: the other has nobody to talk to.
  client.on('close', () => upstream.destroy());
  upstream.on('close', () => client.destroy());
  if (early.length > 0) upstream.write(early);
  client.pipe(upstream);
  upstream.pipe(client);
  return finished.then(() => undefined);
}

abstract class BaseProxy {
  abstract readonly scheme: 'http' | 'https' | 'socks5';

  host: string;
  /** The port; known after `start()`. */
  port: number;
  readonly username: string | null;
  readonly password: string | null;
  readonly connectTimeoutMs: number;
  readonly hosts: ReadonlyMap<string, string>;
  readonly events: ProxyEvent[] = [];

  private readonly onEvent: ((event: ProxyEvent) => void) | undefined;
  private listener: net.Server | null = null;
  private readonly sockets = new Set<net.Socket>();
  private readonly clients = new Set<net.Socket>();
  private readonly waiters = new Set<{
    check: () => void;
    fail: (error: Error) => void;
  }>();

  protected constructor(options: LocalProxyOptions) {
    if ((options.username === undefined) !== (options.password === undefined)) {
      throw new Error('pass both username and password, or neither');
    }
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 0;
    this.username = options.username ?? null;
    this.password = options.password ?? null;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.hosts = new Map(
      Object.entries(options.hosts ?? {}).map(([name, address]) => [
        name.toLowerCase(),
        address,
      ]),
    );
    this.onEvent = options.onEvent;
  }

  protected abstract createServer(
    handler: (socket: net.Socket) => void,
  ): net.Server;
  protected abstract serve(
    socket: net.Socket,
    reader: SocketReader,
    client: string,
  ): Promise<void>;

  // -- lifecycle ---------------------------------------------------------------

  async start(): Promise<this> {
    if (this.listener !== null) return this;
    const server = this.createServer(
      (socket) => void this.handleClient(socket),
    );
    server.on('error', (error) =>
      debug(`${this.scheme} server error: ${error.message}`),
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('proxy did not bind');
    this.listener = server;
    this.port = address.port;
    return this;
  }

  /** Close the listener and every open connection. */
  async stop(): Promise<void> {
    const server = this.listener;
    this.listener = null;
    for (const waiter of this.waiters) waiter.fail(new Error('proxy stopped'));
    if (server === null) return;
    const closed = new Promise<void>((resolve) =>
      server.close(() => resolve()),
    );
    for (const socket of this.sockets) socket.destroy();
    // A connection that does not close must not hang the test run.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, STOP_TIMEOUT_MS);
    });
    await Promise.race([closed, timeout]);
    clearTimeout(timer);
  }

  get running(): boolean {
    return this.listener !== null;
  }

  /** How many client connections are open right now. */
  get connections(): number {
    return this.clients.size;
  }

  // -- convenience -------------------------------------------------------------

  /** The proxy URL without credentials, e.g. `http://127.0.0.1:54321`. */
  get server(): string {
    return `${this.scheme}://${formatHostPort(this.host, this.port)}`;
  }

  /** Alias of `server`. */
  get url(): string {
    return this.server;
  }

  /** The proxy URL with percent-encoded credentials (for HTTP clients that take them in the URL). */
  get urlWithAuth(): string {
    if (this.username === null) return this.server;
    const credentials = `${quote(this.username)}:${quote(this.password ?? '')}@`;
    return `${this.scheme}://${credentials}${formatHostPort(this.host, this.port)}`;
  }

  /** The setting for Playwright / Camoufox `proxy:` (credentials as separate keys). */
  get playwrightProxy(): {
    server: string;
    username?: string;
    password?: string;
  } {
    if (this.username === null) return { server: this.server };
    return {
      server: this.server,
      username: this.username,
      password: this.password ?? '',
    };
  }

  targets(kind?: ProxyEventKind): string[] {
    return this.events
      .filter((e) => kind === undefined || e.kind === kind)
      .map((e) => e.target);
  }

  saw(
    host: string,
    port?: number,
    filter: { kind?: ProxyEventKind; ok?: boolean } = {},
  ): boolean {
    return this.events.some(
      (e) =>
        e.host.toLowerCase() === host.toLowerCase() &&
        (port === undefined || e.port === port) &&
        (filter.kind === undefined || e.kind === filter.kind) &&
        (filter.ok === undefined || e.ok === filter.ok),
    );
  }

  /** Resolve with the first recorded event matching `predicate`, now or later. */
  waitFor(
    predicate: (event: ProxyEvent) => boolean,
    timeoutMs = 10_000,
  ): Promise<ProxyEvent> {
    return new Promise((resolve, reject) => {
      const waiter = { check, fail };
      const timer = setTimeout(
        () => fail(new Error('no matching proxy event')),
        timeoutMs,
      );
      function settle() {
        clearTimeout(timer);
        waiters.delete(waiter);
      }
      const waiters = this.waiters;
      const events = this.events;
      function check() {
        const found = events.find(predicate);
        if (found === undefined) return;
        settle();
        resolve(found);
      }
      function fail(error: Error) {
        settle();
        reject(error);
      }
      waiters.add(waiter);
      check();
    });
  }

  clear(): void {
    this.events.length = 0;
  }

  // -- internals ---------------------------------------------------------------

  protected record(fields: Omit<ProxyEvent, 'timestamp' | 'ok'>): ProxyEvent {
    const socksLike = fields.kind === 'SOCKS5' || fields.kind === 'AUTH';
    const ok = socksLike
      ? fields.status === 0
      : fields.status >= 200 && fields.status < 400;
    const event: ProxyEvent = { ...fields, timestamp: Date.now(), ok };
    this.events.push(event);
    debug(
      `${this.scheme} ${event.client} ${event.method} ${event.target} -> ${event.status}`,
    );
    for (const waiter of this.waiters) waiter.check();
    this.onEvent?.(event);
    return event;
  }

  protected checkCredentials(
    username: string | null,
    password: string | null,
  ): boolean {
    if (this.username === null) return true;
    if (username === null || password === null) return false;
    // Hashes have one length, so the comparison can be constant-time for any input.
    const digest = (value: string) =>
      createHash('sha256').update(value).digest();
    return (
      timingSafeEqual(digest(username), digest(this.username)) &&
      timingSafeEqual(digest(password), digest(this.password ?? ''))
    );
  }

  private async handleClient(socket: net.Socket): Promise<void> {
    this.sockets.add(socket);
    this.clients.add(socket);
    socket.once('close', () => {
      this.sockets.delete(socket);
      this.clients.delete(socket);
    });
    // A reset by the client is normal here; 'close' follows. Without a listener it would be thrown.
    socket.on('error', (error) =>
      debug(`client socket error: ${error.message}`),
    );
    socket.setNoDelay(true);
    const reader = new SocketReader(socket);
    try {
      await this.serve(socket, reader, describePeer(socket));
    } catch (error) {
      if (!(error instanceof EndOfStream))
        console.warn('local proxy handler failed:', error);
    } finally {
      reader.release();
      socket.end();
      // Read what the client still sends, so that its closing is noticed and the socket goes away.
      socket.resume();
    }
  }

  protected async openUpstream(
    host: string,
    port: number,
  ): Promise<net.Socket> {
    const address = this.hosts.get(host.toLowerCase()) ?? host;
    const upstream = net.connect({ host: address, port, allowHalfOpen: true });
    this.sockets.add(upstream);
    upstream.once('close', () => this.sockets.delete(upstream));
    upstream.on('error', (error) =>
      debug(`upstream socket error: ${error.message}`),
    );
    const timer = setTimeout(
      () =>
        upstream.destroy(
          Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }),
        ),
      this.connectTimeoutMs,
    );
    try {
      await new Promise<void>((resolve, reject) => {
        upstream.once('connect', resolve);
        upstream.once('error', reject);
        upstream.once('close', () => reject(new Error('closed')));
      });
    } catch (error) {
      upstream.destroy();
      throw error;
    } finally {
      clearTimeout(timer);
    }
    return upstream;
  }
}

function errnoOf(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}

const REASONS = new Map([
  [400, 'Bad Request'],
  [407, 'Proxy Authentication Required'],
  [502, 'Bad Gateway'],
  [504, 'Gateway Timeout'],
]);

/** HTTP forward proxy with optional `Proxy-Authorization: Basic` auth (and optional TLS). */
export class HttpProxy extends BaseProxy {
  readonly realm = 'local-proxy';
  private readonly tlsOptions: SelfSignedCertificate | undefined;

  constructor(options: HttpProxyOptions = {}) {
    super(options);
    this.tlsOptions = options.tls;
  }

  get scheme(): 'http' | 'https' {
    return this.tlsOptions === undefined ? 'http' : 'https';
  }

  protected createServer(handler: (socket: net.Socket) => void): net.Server {
    return this.tlsOptions === undefined
      ? net.createServer({ allowHalfOpen: true }, handler)
      : tls.createServer({ ...this.tlsOptions, allowHalfOpen: true }, handler);
  }

  protected async serve(
    socket: net.Socket,
    reader: SocketReader,
    client: string,
  ): Promise<void> {
    const head = (await reader.readUntil(CRLF2)).toString('latin1');
    const lines = head.split('\r\n');
    const requestLine = lines[0] ?? '';
    const first = requestLine.indexOf(' ');
    const second = requestLine.indexOf(' ', first + 1);
    if (first < 0 || second < 0) {
      this.respond(socket, 400);
      return;
    }
    const method = requestLine.slice(0, first);
    const target = requestLine.slice(first + 1, second);
    const version = requestLine.slice(second + 1);
    const headers: Array<[string, string]> = [];
    for (const line of lines.slice(1)) {
      if (line === '') continue;
      const colon = line.indexOf(':');
      headers.push(
        colon < 0
          ? [line.trim(), '']
          : [line.slice(0, colon).trim(), line.slice(colon + 1).trim()],
      );
    }

    const [username, password] = basicCredentials(headers);
    const kind = method.toUpperCase() === 'CONNECT' ? 'CONNECT' : 'HTTP';
    let host: string;
    let port: number;
    let path = '/';
    try {
      if (kind === 'CONNECT') {
        [host, port] = splitHostPort(target);
      } else {
        const url = new URL(target);
        if (url.protocol !== 'http:' || url.hostname === '')
          throw new Error('not an absolute http:// URL');
        host = url.hostname.startsWith('[')
          ? url.hostname.slice(1, -1)
          : url.hostname;
        port = url.port === '' ? 80 : Number.parseInt(url.port, 10);
        path = url.pathname + url.search;
      }
    } catch {
      // A target that cannot be read is the client's mistake: answer 400, like any proxy.
      this.record({
        kind,
        method,
        target,
        host: '',
        port: 0,
        status: 400,
        client,
        username,
        addrType: null,
      });
      this.respond(socket, 400);
      return;
    }
    const record = (status: number) =>
      this.record({
        kind,
        method,
        target,
        host,
        port,
        status,
        client,
        username,
        addrType: null,
      });

    if (!this.checkCredentials(username, password)) {
      record(407);
      this.respond(socket, 407, [
        ['Proxy-Authenticate', `Basic realm="${this.realm}"`],
      ]);
      return;
    }

    let upstream: net.Socket;
    try {
      upstream = await this.openUpstream(host, port);
    } catch (error) {
      const timedOut = errnoOf(error) === 'ETIMEDOUT';
      record(timedOut ? 504 : 502);
      this.respond(socket, timedOut ? 504 : 502);
      return;
    }

    record(200);
    const early = reader.release();
    if (kind === 'CONNECT') {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    } else {
      const out = [`${method} ${path} ${version}`];
      for (const [name, value] of headers) {
        if (!HOP_BY_HOP.has(name.toLowerCase())) out.push(`${name}: ${value}`);
      }
      out.push('Connection: close');
      upstream.write(Buffer.from(`${out.join('\r\n')}\r\n\r\n`, 'latin1'));
    }
    await relay(socket, upstream, early);
  }

  private respond(
    socket: net.Socket,
    status: number,
    extra: ReadonlyArray<[string, string]> = [],
  ): void {
    const reason = REASONS.get(status) ?? 'Error';
    const body = Buffer.from(`${status} ${reason}\n`);
    const head = [
      `HTTP/1.1 ${status} ${reason}`,
      'Content-Type: text/plain',
      `Content-Length: ${body.length}`,
      'Connection: close',
      ...extra.map(([name, value]) => `${name}: ${value}`),
    ];
    socket.end(
      Buffer.concat([
        Buffer.from(`${head.join('\r\n')}\r\n\r\n`, 'latin1'),
        body,
      ]),
    );
  }
}

/** `[username, password]` of a Basic `Proxy-Authorization` header, else `[null, null]`. */
function basicCredentials(
  headers: ReadonlyArray<[string, string]>,
): [string | null, string | null] {
  const header = headers.find(
    ([name]) => name.toLowerCase() === 'proxy-authorization',
  );
  if (header === undefined) return [null, null];
  const space = header[1].indexOf(' ');
  const scheme = space < 0 ? header[1] : header[1].slice(0, space);
  const token = space < 0 ? '' : header[1].slice(space + 1).trim();
  if (scheme.toLowerCase() !== 'basic') return [null, null];
  if (token.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(token))
    return [null, null];
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(token, 'base64'),
    );
  } catch {
    // Not UTF-8: not credentials this proxy can read.
    return [null, null];
  }
  const colon = decoded.indexOf(':');
  return colon < 0
    ? [decoded, null]
    : [decoded.slice(0, colon), decoded.slice(colon + 1)];
}

/** `host:port` or `[v6]:port`. Throws on anything else. */
function splitHostPort(value: string): [string, number] {
  const text = value.trim();
  let host: string;
  let portText: string;
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    if (end < 0) throw new Error(text);
    host = text.slice(1, end);
    const rest = text.slice(end + 1);
    if (rest !== '' && !rest.startsWith(':')) throw new Error(text);
    portText = rest.slice(1);
  } else {
    const colon = text.lastIndexOf(':');
    if (colon < 0) throw new Error(`missing port in ${text}`);
    host = text.slice(0, colon);
    portText = text.slice(colon + 1);
  }
  const port = Number.parseInt(portText, 10);
  if (host === '' || !/^[0-9]+$/.test(portText) || port < 1 || port > 65535)
    throw new Error(text);
  return [host, port];
}

/** SOCKS5 proxy (CONNECT only). With username/password it requires RFC 1929 auth. */
export class Socks5Proxy extends BaseProxy {
  readonly scheme = 'socks5';

  // REP codes (RFC 1928, section 6)
  static readonly SUCCEEDED = 0;
  static readonly GENERAL_FAILURE = 1;
  static readonly HOST_UNREACHABLE = 4;
  static readonly CONNECTION_REFUSED = 5;
  static readonly COMMAND_NOT_SUPPORTED = 7;
  static readonly ADDRESS_TYPE_NOT_SUPPORTED = 8;

  constructor(options: LocalProxyOptions = {}) {
    super(options);
  }

  protected createServer(handler: (socket: net.Socket) => void): net.Server {
    return net.createServer({ allowHalfOpen: true }, handler);
  }

  protected async serve(
    socket: net.Socket,
    reader: SocketReader,
    client: string,
  ): Promise<void> {
    const [version = 0, methodCount = 0] = await reader.readExactly(2);
    if (version !== 5) return;
    const methods = await reader.readExactly(methodCount);
    const wanted = this.username === null ? 0x00 : 0x02;
    if (!methods.includes(wanted)) {
      socket.write(Buffer.from([5, 0xff]));
      this.record({
        kind: 'AUTH',
        method: 'METHOD',
        target: '',
        host: '',
        port: 0,
        status: 0xff,
        client,
        username: null,
        addrType: null,
      });
      return;
    }
    socket.write(Buffer.from([5, wanted]));

    let username: string | null = null;
    if (wanted === 0x02) {
      const [, usernameLength = 0] = await reader.readExactly(2);
      username = (await reader.readExactly(usernameLength)).toString('utf8');
      const [passwordLength = 0] = await reader.readExactly(1);
      const password = (await reader.readExactly(passwordLength)).toString(
        'utf8',
      );
      if (!this.checkCredentials(username, password)) {
        socket.write(Buffer.from([1, 1]));
        this.record({
          kind: 'AUTH',
          method: 'USERPASS',
          target: '',
          host: '',
          port: 0,
          status: 1,
          client,
          username,
          addrType: null,
        });
        return;
      }
      socket.write(Buffer.from([1, 0]));
    }

    const [, command = 0, , addressType = 0] = await reader.readExactly(4);
    let host: string;
    let addrType: 'domain' | 'ipv4' | 'ipv6';
    if (addressType === 1) {
      host = [...(await reader.readExactly(4))].join('.');
      addrType = 'ipv4';
    } else if (addressType === 4) {
      const raw = await reader.readExactly(16);
      host = Array.from({ length: 8 }, (_, i) =>
        raw.readUInt16BE(i * 2).toString(16),
      ).join(':');
      addrType = 'ipv6';
    } else if (addressType === 3) {
      const [length = 0] = await reader.readExactly(1);
      host = (await reader.readExactly(length)).toString('latin1');
      addrType = 'domain';
    } else {
      this.reply(socket, Socks5Proxy.ADDRESS_TYPE_NOT_SUPPORTED);
      return;
    }
    const port = (await reader.readExactly(2)).readUInt16BE(0);
    const method =
      (
        { 1: 'CONNECT', 2: 'BIND', 3: 'UDP_ASSOCIATE' } as Record<
          number,
          string
        >
      )[command] ?? `CMD${command}`;
    const record = (status: number) =>
      this.record({
        kind: 'SOCKS5',
        method,
        target: formatHostPort(host, port),
        host,
        port,
        status,
        client,
        username,
        addrType,
      });

    if (command !== 1) {
      record(Socks5Proxy.COMMAND_NOT_SUPPORTED);
      this.reply(socket, Socks5Proxy.COMMAND_NOT_SUPPORTED);
      return;
    }
    let upstream: net.Socket;
    try {
      upstream = await this.openUpstream(host, port);
    } catch (error) {
      const refused = errnoOf(error) === 'ECONNREFUSED';
      const rep = refused
        ? Socks5Proxy.CONNECTION_REFUSED
        : Socks5Proxy.HOST_UNREACHABLE;
      record(rep);
      this.reply(socket, rep);
      return;
    }
    record(Socks5Proxy.SUCCEEDED);
    const early = reader.release();
    this.reply(
      socket,
      Socks5Proxy.SUCCEEDED,
      upstream.localAddress,
      upstream.localPort,
    );
    await relay(socket, upstream, early);
  }

  private reply(
    socket: net.Socket,
    rep: number,
    bindHost?: string,
    bindPort = 0,
  ): void {
    // Clients ignore the bound address of a CONNECT; IPv6 ones get 0.0.0.0.
    const octets =
      bindHost !== undefined && net.isIPv4(bindHost)
        ? bindHost.split('.').map(Number)
        : [0, 0, 0, 0];
    const port = Buffer.alloc(2);
    port.writeUInt16BE(bindPort);
    socket.write(Buffer.concat([Buffer.from([5, rep, 0, 1, ...octets]), port]));
  }
}

// -- certificates ----------------------------------------------------------------

export interface SelfSignedCertificate {
  /** PEM. Also what a client passes as the trusted CA. */
  cert: string;
  /** PEM, PKCS#8. */
  key: string;
}

/**
 * A throw-away self-signed certificate, made in process (an ECDSA P-256 key, valid
 * for two days). It is its own trust anchor: give `cert` to the client as `ca`.
 */
export async function selfSignedCertificate(
  names: { ips?: readonly string[]; dns?: readonly string[] } = {},
): Promise<SelfSignedCertificate> {
  const ips = names.ips ?? (names.dns === undefined ? ['127.0.0.1'] : []);
  const algorithm = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const keys = await crypto.subtle.generateKey(algorithm, true, [
    'sign',
    'verify',
  ]);
  const now = Date.now();
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: `01${randomBytes(7).toString('hex')}`, // a leading 01 keeps the number positive
    // A name of its own: two certificates that share a name confuse a trust store that holds both.
    name: `CN=session-manager test ${randomBytes(4).toString('hex')}`,
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + 2 * 24 * 3600 * 1000),
    signingAlgorithm: algorithm,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyCertSign,
        true,
      ),
      new x509.SubjectAlternativeNameExtension(
        [
          ...ips.map((value) => ({ type: 'ip' as const, value })),
          ...(names.dns ?? []).map((value) => ({
            type: 'dns' as const,
            value,
          })),
        ],
        false,
      ),
    ],
  });
  const pkcs8 = Buffer.from(
    await crypto.subtle.exportKey('pkcs8', keys.privateKey),
  );
  const body =
    pkcs8
      .toString('base64')
      .match(/.{1,64}/g)
      ?.join('\n') ?? '';
  return {
    cert: certificate.toString('pem'),
    // nosemgrep: tools.opengrep.ts-no-private-key-literal -- not a literal: the PEM of a key generated for this test run, which never leaves the process
    key: `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`,
  };
}

// -- servers to be proxied to ------------------------------------------------------

export interface TestServer {
  readonly port: number;
  /** Close the listener and every open connection. */
  stop(): Promise<void>;
}

/**
 * A TCP (or, with `tls`, TLS) server on 127.0.0.1 that hands every connection to
 * `onConnection`. It stops cleanly: `stop()` destroys what is still open, so a test
 * never hangs on a connection it forgot.
 */
export async function startTcpServer(
  // May be async: a script that waits for the client's bytes and answers them.
  onConnection: (socket: net.Socket) => unknown,
  options: { tls?: SelfSignedCertificate } = {},
): Promise<TestServer> {
  const sockets = new Set<net.Socket>();
  const handler = (socket: net.Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    // A peer that resets the connection is part of the tests; 'close' follows.
    socket.on('error', (error) =>
      debug(`test server socket error: ${error.message}`),
    );
    // A script is cut short when the client hangs up on it: that is part of
    // the test, not a failure of it.
    Promise.resolve(onConnection(socket)).catch((error: unknown) =>
      debug(`test server script ended early: ${errorText(error)}`),
    );
  };
  const server =
    options.tls === undefined
      ? net.createServer({ allowHalfOpen: true }, handler)
      : tls.createServer({ ...options.tls, allowHalfOpen: true }, handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('server did not bind');
  let stopped: Promise<void> | undefined;
  return {
    port: address.port,
    stop() {
      stopped ??= new Promise<void>((resolve) => {
        server.close(() => resolve());
        for (const socket of sockets) socket.destroy();
      });
      return stopped;
    },
  };
}

export interface Origin extends TestServer {
  /** The request heads it got, in order. */
  readonly heads: string[];
}

/**
 * A web server that reads one request head per connection and answers "hello"
 * (or whatever `respond` writes to the socket), and keeps the heads it got.
 */
export async function startOrigin(
  respond?: (head: string, socket: net.Socket) => void,
): Promise<Origin> {
  const heads: string[] = [];
  const serve = async (socket: net.Socket) => {
    try {
      const head = (await new SocketReader(socket).readUntil(CRLF2)).toString(
        'latin1',
      );
      heads.push(head);
      if (respond) respond(head, socket);
      else
        socket.end(
          'HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: keep-alive\r\n\r\nhello',
        );
    } catch (error) {
      if (!(error instanceof EndOfStream))
        console.warn('origin handler failed:', error);
    }
  };
  const server = await startTcpServer((socket) => void serve(socket));
  return { port: server.port, stop: () => server.stop(), heads };
}

/** The port a listening server is bound to. */
export function portOf(server: {
  address(): string | net.AddressInfo | null;
}): number {
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('server is not listening');
  return address.port;
}

/**
 * A port nothing listens on: connecting to it on 127.0.0.1 is refused until the
 * test that asked for it ends. A port that was only closed again goes back to
 * the system, which can hand it to the next server that asks for any port, here
 * or in another process - and that server would answer in its place. So a
 * socket of ours stays bound to the port without listening (it is connected to
 * a server of ours). Linux then hands the port to no other socket until the
 * test ends; other systems may still hand it to a server that asks for any port.
 */
export async function closedPort(): Promise<number> {
  let release = async (): Promise<void> => undefined;
  onTestFinished(() => release());
  const peer = await startTcpServer(() => undefined);
  release = () => peer.stop();
  // Bound to an address without a port: the system picks one no socket uses.
  const holder = await connectTo(peer.port, '127.0.0.1', '127.0.0.1');
  release = async () => {
    holder.destroy();
    await peer.stop();
  };
  if (holder.localPort === undefined)
    throw new Error('the holder is not bound');
  return holder.localPort;
}

// -- clients that talk to a proxy by hand ---------------------------------------------

export interface RawResponse {
  status: number;
  reason: string;
  /** Header names are lower-cased. */
  headers: Record<string, string>;
  body: string;
  /** Everything the server sent. */
  raw: string;
}

/** Everything a socket sends until it closes, or fail after `timeoutMs`. */
export function readAll(socket: net.Socket, timeoutMs = 5000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`no end of data within ${timeoutMs} ms`));
    }, timeoutMs);
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks));
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.resume();
  });
}

export function parseRawResponse(raw: string): RawResponse {
  const split = raw.indexOf('\r\n\r\n');
  const head = split < 0 ? raw : raw.slice(0, split);
  const body = split < 0 ? '' : raw.slice(split + 4);
  const [statusLine = '', ...lines] = head.split('\r\n');
  const match = /^HTTP\/\S+ (\d{3})(?: (.*))?$/.exec(statusLine);
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon > 0)
      headers[line.slice(0, colon).trim().toLowerCase()] = line
        .slice(colon + 1)
        .trim();
  }
  return {
    status: Number(match?.[1] ?? 0),
    reason: match?.[2] ?? '',
    headers,
    body,
    raw,
  };
}

/**
 * Send `request` (the bytes of a whole HTTP request) to a server and read the
 * answer up to the end of the connection. Send `Connection: close` or half-close
 * (the default) so that the server ends it.
 */
export async function rawHttp(
  port: number,
  request: string,
  options: { host?: string; halfClose?: boolean; timeoutMs?: number } = {},
): Promise<RawResponse> {
  const socket = await connectTo(port, options.host);
  const answer = readAll(socket, options.timeoutMs);
  socket.write(Buffer.from(request, 'latin1'));
  if (options.halfClose !== false) socket.end();
  try {
    return parseRawResponse((await answer).toString('latin1'));
  } finally {
    socket.destroy();
  }
}

/** A connected client socket. A reset after this is the test's business: it is not thrown. */
async function connectTo(
  port: number,
  host = '127.0.0.1',
  // The address to connect from, on a port the system picks; any when unset.
  localAddress?: string,
): Promise<net.Socket> {
  const socket = net.connect({ host, port, localAddress });
  socket.on('error', (error) => debug(`client socket error: ${error.message}`));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => {
      socket.off('error', reject);
      resolve();
    });
    socket.once('error', reject);
  });
  return socket;
}

/**
 * Open a `CONNECT` tunnel through an HTTP proxy by hand. Resolves with the head
 * of the proxy's answer, the socket, and the reader on it, which carries what the
 * tunnel sends from here on (`reader.readExactly(n)`, `reader.readToEnd()`).
 */
export async function connectThrough(
  proxyPort: number,
  target: string,
  headers: readonly string[] = [],
): Promise<{ socket: net.Socket; head: string; reader: SocketReader }> {
  const socket = await connectTo(proxyPort);
  socket.write(
    `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${headers.map((h) => `${h}\r\n`).join('')}\r\n`,
  );
  const reader = new SocketReader(socket);
  try {
    const head = (await reader.readUntil(CRLF2)).toString('latin1');
    return { socket, head, reader };
  } catch (error) {
    socket.destroy();
    throw error;
  }
}
