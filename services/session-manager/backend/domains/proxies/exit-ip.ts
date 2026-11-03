// Find the public exit IP of a proxy with undici (`ProxyAgent` for http(s)
// proxies, `Socks5ProxyAgent` for SOCKS5).
//
// Host names are resolved by the proxy for both HTTP (CONNECT host:443) and
// SOCKS5. The proxy's credentials go to undici as options, never into a URL,
// so they cannot show up in an error or a log.

import { Buffer } from 'node:buffer';
import net from 'node:net';

// Not 'undici': Bun answers that name with a stand-in of its own, whose ProxyAgent cannot be closed
// and which has no Socks5ProxyAgent. The file path reaches the real package.
import {
  Client,
  Pool,
  ProxyAgent,
  Socks5ProxyAgent,
  buildConnector,
  request,
} from 'undici/index.js';
import type { Dispatcher } from 'undici/index.js';

import { isRecord } from '../../../lib/is-record.ts';
import { debugLog } from '../../lib/debug.ts';
import { errorText } from '../../lib/error-text.ts';
import type { TrustAnchors } from './connect.ts';
import { normalizeIp } from './ip.ts';
import { ExitIpError, hasAuth, hostPort } from './types.ts';
import type { ExitIp, ExitIpChecker, ProxyConfig } from './types.ts';

const debug = debugLog('proxies');

export interface Endpoint {
  url: string;
  /** The JSON field that holds the IP. Without it the body is the plain-text IP. */
  jsonKey?: string;
}

export const DEFAULT_ENDPOINTS: readonly Endpoint[] = [
  { url: 'https://api.ipify.org?format=json', jsonKey: 'ip' },
  { url: 'https://checkip.amazonaws.com' },
  { url: 'https://icanhazip.com' },
];

export interface ExitIpCheckerOptions {
  /** The IP echo services, asked in order. */
  endpoints?: readonly Endpoint[];
  /** Bounds the connection to the proxy (TCP, TLS). Default 8 s. */
  connectTimeoutMs?: number;
  /** Bounds the whole check. Default 15 s. */
  totalTimeoutMs?: number;
  /** The country of an IP (ISO 3166-1 alpha-2). The default knows none. */
  countryLookup?: (ip: string) => Promise<string | null> | string | null;
  /** Trust anchors for the TLS to an `https` proxy and to the echo services. For tests. */
  ca?: TrustAnchors;
}

/** An IP echo answer is a few bytes; more is not one. */
const BODY_LIMIT = 64 * 1024;
// undici gives a SOCKS5 handshake this long to answer, and does not report which step stalled.
const SOCKS5_HANDSHAKE_SECONDS = 5;

// What the platform's `safe-fetch` takes for a failed TLS handshake.
const TLS_ERROR_CODE =
  /^(CERT_|ERR_TLS_|ERR_SSL_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT|HOSTNAME_MISMATCH|UND_ERR_PRX_TLS)/;
// Errors of the connection to the proxy itself. A reset or a close later is the
// request's, not the proxy's.
const CANNOT_CONNECT = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EAI_NONAME',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
  'ETIMEDOUT',
]);
const SOCKS5_CREDENTIALS_REFUSED = new Set([
  'UND_ERR_SOCKS5_AUTH_FAILED',
  'UND_ERR_SOCKS5_AUTH_REJECTED',
  'UND_ERR_SOCKS5_AUTH_METHOD',
  'UND_ERR_SOCKS5_AUTH_VERSION',
]);

function seconds(ms: number): string {
  return String(ms / 1000);
}

function errorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  if (typeof error.code === 'string') return error.code;
  return errorCode(error.cause);
}

/** The endpoint's answer was not an IP. */
class UnexpectedAnswer extends Error {}

/** The proxy gave `statusCode` to a CONNECT, in undici's words. */
function tunnelStatus(error: unknown): number | undefined {
  const match = /^Proxy response \((\d{3})\) !== 200 when HTTP Tunneling$/.exec(
    errorText(error),
  );
  return match ? Number(match[1]) : undefined;
}

export class HttpExitIpChecker implements ExitIpChecker {
  private readonly endpoints: readonly Endpoint[];
  private readonly connectTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly countryLookup: (
    ip: string,
  ) => Promise<string | null> | string | null;
  private readonly ca: TrustAnchors;

  /**
   * Tries the endpoints in order. Errors about the proxy itself (bad
   * credentials, refused, not answering) abort at once, since every other
   * endpoint would fail the same way.
   */
  constructor(options: ExitIpCheckerOptions = {}) {
    this.endpoints = options.endpoints ?? DEFAULT_ENDPOINTS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? 8000;
    this.totalTimeoutMs = options.totalTimeoutMs ?? 15_000;
    this.countryLookup = options.countryLookup ?? (() => null);
    this.ca = options.ca;
  }

  async check(proxy: ProxyConfig): Promise<ExitIp> {
    const dispatcher = this.dispatcherFor(proxy);
    const expiry = { expired: false };
    // undici cannot cancel a connection that is still being made (an abort signal
    // only takes hold once the request has been written), so the time limit
    // destroys the dispatcher.
    const timer = setTimeout(() => {
      expiry.expired = true;
      dispatcher
        .destroy()
        .catch((error: unknown) =>
          debug(`destroy failed: ${errorText(error)}`),
        );
    }, this.totalTimeoutMs);
    let found: { ip: string; elapsedMs: number };
    try {
      found = await this.firstAnswer(dispatcher, expiry);
    } catch (error) {
      if (expiry.expired) {
        throw new ExitIpError(
          `no answer through the proxy within ${seconds(this.totalTimeoutMs)} s`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
      await dispatcher.destroy().catch((error: unknown) => {
        debug(`destroy failed: ${errorText(error)}`);
      });
    }
    return {
      ip: found.ip,
      country: await this.countryOf(found.ip),
      latencyMs: Math.round(found.elapsedMs),
    };
  }

  private async countryOf(ip: string): Promise<string | null> {
    try {
      return await this.countryLookup(ip);
    } catch (error) {
      // The country is a bonus: a broken GeoIP database must not make a working proxy "not working".
      console.warn(`[exit-ip] country lookup failed: ${errorText(error)}`);
      return null;
    }
  }

  private dispatcherFor(proxy: ProxyConfig): Dispatcher {
    const timeout = this.connectTimeoutMs;
    const requestTls = { ca: this.ca, timeout };
    if (proxy.scheme === 'socks5') {
      const connector = buildConnector({ timeout });
      // `requestTls` (TLS to the echo service) is read by the agent but missing from its types.
      const options: NonNullable<
        ConstructorParameters<typeof Socks5ProxyAgent>[1]
      > & {
        requestTls: typeof requestTls;
      } = {
        ...(hasAuth(proxy)
          ? { username: proxy.username ?? '', password: proxy.password ?? '' }
          : {}),
        // The agent reads the host from a URL, where an IPv6 address keeps its brackets.
        connect: (target, callback) =>
          connector(
            {
              ...target,
              hostname: unbracket(target.hostname),
              ...(target.host === undefined
                ? {}
                : { host: unbracket(target.host) }),
            },
            callback,
          ),
        requestTls,
      };
      return new Socks5ProxyAgent(`socks5://${hostPort(proxy)}`, options);
    }
    const proxyTls = { ca: this.ca, timeout };
    const toProxy = buildConnector(proxyTls);
    return new ProxyAgent({
      uri: `${proxy.scheme}://${hostPort(proxy)}`,
      // Plain-http endpoints are forwarded to the proxy as they are, https ones tunneled with CONNECT.
      proxyTunnel: false,
      ...(hasAuth(proxy) ? { token: basicToken(proxy) } : {}),
      proxyTls,
      requestTls,
      // undici names the proxy as the TLS server, and a runtime refuses an IP address as a server
      // name; the certificate is then checked against the address by `tls` itself.
      clientFactory: (origin) =>
        new Client(origin, {
          connect: withoutTypeOfService((options, callback) =>
            toProxy(
              net.isIP(unbracket(options.hostname)) === 0
                ? options
                : { ...options, servername: undefined },
              callback,
            ),
          ),
        }),
      factory: tunnelPool,
      headersTimeout: this.totalTimeoutMs,
      bodyTimeout: this.totalTimeoutMs,
    });
  }

  private async firstAnswer(
    dispatcher: Dispatcher,
    expiry: { expired: boolean },
  ): Promise<{ ip: string; elapsedMs: number }> {
    const failures: string[] = [];
    for (const endpoint of this.endpoints) {
      if (expiry.expired) break;
      const started = performance.now();
      let statusCode: number;
      let text: string;
      try {
        ({ statusCode, text } = await fetchText(dispatcher, endpoint));
      } catch (error) {
        if (error instanceof UnexpectedAnswer) {
          failures.push(
            `${endpoint.url}: unexpected answer (${error.message})`,
          );
          continue;
        }
        const verdict = explainFailure(error, this.connectTimeoutMs);
        if (verdict instanceof ExitIpError) throw verdict;
        failures.push(`${endpoint.url}: ${verdict}`);
        continue;
      }
      if (statusCode === 407) {
        // A plain-http endpoint through an HTTP proxy.
        throw new ExitIpError('the proxy rejected the credentials (HTTP 407)');
      }
      try {
        return {
          ip: parseIp(endpoint, statusCode, text),
          elapsedMs: performance.now() - started,
        };
      } catch (error) {
        if (!(error instanceof UnexpectedAnswer)) throw error;
        failures.push(`${endpoint.url}: unexpected answer (${error.message})`);
      }
    }
    throw new ExitIpError(
      `no IP echo service answered through the proxy: ${failures.join('; ')}`,
    );
  }
}

/**
 * An `ExitIpError` if the failure is the proxy's (the check ends), else the
 * words for this endpoint's failure (the next endpoint is tried). Exported for
 * the tests of the error shapes undici and the runtime produce.
 */
export function explainFailure(
  error: unknown,
  connectTimeoutMs: number,
): ExitIpError | string {
  const code = errorCode(error);
  const message = errorText(error);

  if (code === 'UND_ERR_CONNECT_TIMEOUT') {
    return new ExitIpError(
      `the proxy did not answer within ${seconds(connectTimeoutMs)} s`,
    );
  }
  // The proxy answered a CONNECT with an error.
  const refused = tunnelStatus(error);
  if (refused === 407)
    return new ExitIpError('the proxy rejected the credentials');
  if (refused !== undefined)
    return `the proxy refused the tunnel (HTTP ${refused})`;
  // ... or a plain request with 407, which undici turns into an argument error.
  if (code === 'UND_ERR_INVALID_ARG' && message.includes('(407)')) {
    return new ExitIpError('the proxy rejected the credentials (HTTP 407)');
  }
  if (code !== undefined && SOCKS5_CREDENTIALS_REFUSED.has(code)) {
    return new ExitIpError('the proxy rejected the credentials');
  }
  if (
    code === 'UND_ERR_SOCKS5_VERSION' ||
    code === 'UND_ERR_SOCKS5_REPLY_VERSION'
  ) {
    return new ExitIpError(
      'cannot connect to the proxy (it is not a SOCKS5 proxy)',
    );
  }
  if (/^SOCKS5 (authentication|connection) timeout$/.test(message)) {
    return new ExitIpError(
      `the proxy did not answer within ${SOCKS5_HANDSHAKE_SECONDS} s`,
    );
  }
  if (code !== undefined && CANNOT_CONNECT.has(code)) {
    return new ExitIpError(`cannot connect to the proxy (${message})`);
  }
  // A TLS problem with this endpoint (or a proxy that intercepts TLS).
  if (code !== undefined && TLS_ERROR_CODE.test(code)) {
    // undici wraps the certificate error of an https proxy, and says only that the connection failed.
    const cause = isRecord(error) ? error.cause : undefined;
    const reason =
      code === 'UND_ERR_PRX_TLS' && cause instanceof Error
        ? cause.message
        : message;
    return `TLS handshake failed: ${reason}`;
  }
  // The proxy could not reach the endpoint: SOCKS5 "host unreachable", ...
  if (code?.startsWith('UND_ERR_SOCKS5_REPLY_')) return message;
  // Read timeouts, protocol errors, ...
  const name = error instanceof Error ? error.name : 'Error';
  return `${name} ${message}`.trim();
}

function isConnector(value: unknown): value is buildConnector.connector {
  return typeof value === 'function';
}

/**
 * undici sets the IP type of service on every socket it writes a request to.
 * Bun refuses that on a TLS socket that wraps another TLS socket (EBADF), and
 * the error is thrown from an event handler, where nothing catches it. A request
 * through an https proxy to an https site is such a socket. The setting means
 * nothing to a request that runs through a tunnel, so the sockets of the
 * agent's pools are made without it.
 */
function withoutTypeOfService(
  connect: buildConnector.connector,
): buildConnector.connector {
  return (options, callback) =>
    connect(options, (...result) => {
      const [, socket] = result;
      if (socket)
        Object.defineProperty(socket, 'setTypeOfService', { value: undefined });
      callback(...result);
    });
}

/** The pool of an origin, which gets the tunnel's connect function in its options. */
function tunnelPool(origin: string | URL, options: object): Dispatcher {
  const connect: unknown = Reflect.get(options, 'connect');
  if (!isConnector(connect))
    throw new TypeError('undici gave no connect function to the pool');
  return new Pool(origin, {
    ...options,
    connect: withoutTypeOfService(connect),
  });
}

/** The password never leaves this function except in the header value. */
function basicToken(proxy: ProxyConfig): string {
  const credentials = `${proxy.username}:${proxy.password ?? ''}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

function unbracket(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

async function fetchText(
  dispatcher: Dispatcher,
  endpoint: Endpoint,
): Promise<{ statusCode: number; text: string }> {
  const response = await request(endpoint.url, {
    dispatcher,
    method: 'GET',
    headers: { accept: '*/*', 'user-agent': 'session-manager' },
    // Redirects are not followed: an echo service has no business redirecting.
  });
  // A body that is dropped before its end reports an abort, which would be thrown as uncaught.
  response.body.on('error', (error) =>
    debug(`answer body error: ${error.message}`),
  );
  if (response.statusCode !== 200) {
    response.body.destroy();
    return { statusCode: response.statusCode, text: '' };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    if (!(chunk instanceof Uint8Array))
      throw new UnexpectedAnswer('answer is not text');
    size += chunk.length;
    if (size > BODY_LIMIT) {
      response.body.destroy();
      throw new UnexpectedAnswer('answer too large');
    }
    chunks.push(Buffer.from(chunk));
  }
  return { statusCode: 200, text: Buffer.concat(chunks).toString('utf8') };
}

function parseIp(endpoint: Endpoint, statusCode: number, text: string): string {
  if (statusCode !== 200) throw new UnexpectedAnswer(`HTTP ${statusCode}`);
  let raw: unknown = text;
  if (endpoint.jsonKey !== undefined) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new UnexpectedAnswer('not JSON');
    }
    if (!isRecord(data) || !(endpoint.jsonKey in data)) {
      throw new UnexpectedAnswer(`no "${endpoint.jsonKey}" field`);
    }
    raw = data[endpoint.jsonKey];
  }
  const ip = typeof raw === 'string' ? normalizeIp(raw.trim()) : null;
  if (ip === null) throw new UnexpectedAnswer('not an IP address');
  return ip;
}
