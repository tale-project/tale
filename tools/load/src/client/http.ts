/**
 * The HTTP client every virtual user issues ordinary requests through.
 *
 * One undici `Agent` serves the whole process: keep-alive sockets are shared
 * by every user, pipelining stays at 1 so one slow response never holds up
 * another user's request queued behind it, and the connection count per
 * origin is unbounded because each user also parks one or two long-lived
 * event streams on their own sockets — a bounded pool would let those
 * streams starve ordinary requests.
 *
 * A request never throws. Every outcome — success, an unexpected status, a
 * refused connection, a timeout — comes back as a response and is recorded
 * in the metrics registry under the caller's metric name: the duration
 * always, the status always (`0` for a network failure), and an error for
 * anything unexpected with a sample of what came back.
 */

// The explicit file, not the bare `undici`: Bun answers the bare specifier
// with its own built-in stub, whose Agent has no `request`, and the tests run
// under Bun. Node resolves both to the same package.
import { Agent } from 'undici/index.js';
import type { Dispatcher } from 'undici/index.js';

import type { MetricsRegistry } from '../metrics/registry.ts';
import type { CookieJar } from './cookies.ts';

export interface AgentOptions {
  /** TCP (and TLS) connect timeout. Default 10 s. */
  connectTimeoutMs?: number;
  /** Time allowed until response headers arrive. Default 60 s. */
  headersTimeoutMs?: number;
  /** How long an idle keep-alive socket is kept. Default 30 s. */
  keepAliveTimeoutMs?: number;
  /** Sockets per origin; `null` (the default) is unbounded. */
  connections?: number | null;
  /**
   * Source address for outgoing connections. A generator holding tens of
   * thousands of streams runs out of ephemeral ports on one address (about
   * 16k on macOS, 28k on a default Linux); one agent per extra address
   * lifts that ceiling.
   */
  localAddress?: string;
}

/**
 * The process-wide agent. `bodyTimeout` is off because event streams stay
 * silent between heartbeats; ordinary requests carry their own deadline
 * through an abort signal instead (see `HttpClient`).
 */
export function createAgent(options: AgentOptions = {}): Agent {
  return new Agent({
    connections: options.connections ?? null,
    pipelining: 1,
    keepAliveTimeout: options.keepAliveTimeoutMs ?? 30_000,
    headersTimeout: options.headersTimeoutMs ?? 60_000,
    bodyTimeout: 0,
    connect: {
      timeout: options.connectTimeoutMs ?? 10_000,
      ...(options.localAddress === undefined
        ? {}
        : { localAddress: options.localAddress }),
    },
  });
}

export type HttpMethod =
  | 'GET'
  | 'HEAD'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'OPTIONS';

export type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly (string | number | boolean)[];

export type ResponseHeaders = Record<string, string | string[] | undefined>;

export interface HttpRequestOptions {
  method: HttpMethod;
  /** Path below the base URL, e.g. `/api/app/chat/threads`. */
  path: string;
  /** Appended to the path; `null`/`undefined` values are skipped. */
  query?: Record<string, QueryValue>;
  /** Serialized as the JSON body, with `content-type: application/json`. */
  json?: unknown;
  /** A raw body; ignored when `json` is given. */
  body?: string | Uint8Array;
  /** Extra headers; they override everything the client sets itself. */
  headers?: Record<string, string>;
  /** Metric name, e.g. `GET /api/app/chat/threads`. */
  name: string;
  /** Statuses that count as success. Default: any 2xx, and 304. */
  expect?: readonly number[];
  /** Deadline for the whole exchange, body included. */
  timeoutMs?: number;
  /**
   * Revalidate through the client's ETag cache: send `If-None-Match` when
   * this path and query were fetched before, and answer a 304 with the
   * cached body. GET only.
   */
  etag?: boolean;
}

export interface HttpClientOptions {
  /** Deployment base URL; a path prefix is kept and prepended. */
  baseUrl: string;
  agent: Dispatcher;
  metrics: MetricsRegistry;
  defaultHeaders?: Record<string, string>;
  /** Default per-request deadline. Default 30 s. */
  timeoutMs?: number;
  /**
   * Sent as `X-Forwarded-For`. The platform trusts it from loopback and
   * private peers, so a generator behind such a hop can spread users over
   * many client IPs instead of tripping the per-IP sign-in limit.
   */
  forwardedFor?: string;
  /** When given, every request sends its cookies and absorbs `Set-Cookie`. */
  cookies?: CookieJar;
  /** Entries in the ETag cache. Default 16. */
  etagCacheSize?: number;
}

/** Bodies larger than this are not kept for 304 replay. */
const ETAG_BODY_MAX = 256 * 1024;
const EMPTY_HEADERS: ResponseHeaders = Object.freeze({});

/** The reason a request's deadline aborts it with. */
class RequestTimeoutError extends Error {
  readonly code = 'TIMEOUT';

  constructor(ms: number) {
    super(`request exceeded its ${ms} ms deadline`);
    this.name = 'RequestTimeoutError';
  }
}

function abortForTimeout(controller: AbortController, ms: number): void {
  controller.abort(new RequestTimeoutError(ms));
}

/**
 * A short, stable error code for a thrown error: undici's `UND_ERR_*`, a
 * socket's `ECONNREFUSED`/`ECONNRESET`, the deadline's `TIMEOUT`, or the
 * error's name when it has no code.
 */
export function errorCode(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'UNKNOWN';
  }
  const code: unknown = Reflect.get(error, 'code');
  if (typeof code === 'string' && code !== '') {
    return code;
  }
  const cause: unknown = error.cause;
  if (cause instanceof Error) {
    const causeCode: unknown = Reflect.get(cause, 'code');
    if (typeof causeCode === 'string' && causeCode !== '') {
      return causeCode;
    }
  }
  return error.name === '' ? 'Error' : error.name;
}

function encodeQuery(query: Record<string, QueryValue>): string {
  let out = '';
  for (const key in query) {
    const value = query[key];
    if (value === undefined || value === null) {
      continue;
    }
    const encodedKey = encodeURIComponent(key);
    if (typeof value === 'object') {
      for (const item of value) {
        out += `${out === '' ? '' : '&'}${encodedKey}=${encodeURIComponent(String(item))}`;
      }
    } else {
      out += `${out === '' ? '' : '&'}${encodedKey}=${encodeURIComponent(String(value))}`;
    }
  }
  return out;
}

/** `path` with `query` appended, respecting a query the path already has. */
export function withQuery(
  path: string,
  query: Record<string, QueryValue> | undefined,
): string {
  if (query === undefined) {
    return path;
  }
  const encoded = encodeQuery(query);
  if (encoded === '') {
    return path;
  }
  return `${path}${path.includes('?') ? '&' : '?'}${encoded}`;
}

/** What a request came back with. Never thrown; check `ok`. */
export class HttpResponse<T = unknown> {
  /** HTTP status, or `0` when the request failed before a response. */
  readonly status: number;
  /** Whether the status was one the request expected. */
  readonly ok: boolean;
  readonly headers: ResponseHeaders;
  /** Wall time from dispatch until the body was fully read. */
  readonly ms: number;
  /** The body; on an ETag cache hit, the cached body. */
  readonly text: string;
  /** Whether a 304 was answered from the ETag cache. */
  readonly cacheHit: boolean;
  /** The error kind recorded for this request, if any (`http_500`, …). */
  readonly errorKind: string | undefined;
  #parsed: T | undefined;
  #parseError: string | undefined;
  #didParse = false;

  constructor(init: {
    status: number;
    ok: boolean;
    headers: ResponseHeaders;
    ms: number;
    text: string;
    cacheHit: boolean;
    errorKind: string | undefined;
  }) {
    this.status = init.status;
    this.ok = init.ok;
    this.headers = init.headers;
    this.ms = init.ms;
    this.text = init.text;
    this.cacheHit = init.cacheHit;
    this.errorKind = init.errorKind;
  }

  /** The body parsed as JSON, or `undefined` when empty or not JSON. */
  json(): T | undefined {
    if (!this.#didParse) {
      this.#didParse = true;
      if (this.text !== '') {
        try {
          this.#parsed = JSON.parse(this.text) as T;
        } catch (error) {
          this.#parseError =
            error instanceof Error ? error.message : String(error);
        }
      }
    }
    return this.#parsed;
  }

  /** Why `json()` returned `undefined` for a non-empty body. */
  get jsonError(): string | undefined {
    this.json();
    return this.#parseError;
  }

  /** A response header as one string (repeated headers joined by `, `). */
  header(name: string): string | undefined {
    const value = this.headers[name.toLowerCase()];
    return Array.isArray(value) ? value.join(', ') : value;
  }
}

interface EtagEntry {
  etag: string;
  text: string;
}

export class HttpClient {
  readonly baseUrl: string;
  /** The base URL's origin, sent as `Origin` on every non-GET request. */
  readonly origin: string;
  readonly #basePath: string;
  readonly #agent: Dispatcher;
  readonly #metrics: MetricsRegistry;
  readonly #defaultHeaders: Record<string, string> | undefined;
  readonly #timeoutMs: number;
  readonly #cookies: CookieJar | undefined;
  readonly #etagLimit: number;
  #forwardedFor: string | undefined;
  /** Allocated on first use: most users never revalidate anything. */
  #etags: Map<string, EtagEntry> | null = null;

  constructor(options: HttpClientOptions) {
    const url = new URL(options.baseUrl);
    this.baseUrl = options.baseUrl;
    this.origin = url.origin;
    this.#basePath = url.pathname.replace(/\/+$/, '');
    this.#agent = options.agent;
    this.#metrics = options.metrics;
    this.#defaultHeaders = options.defaultHeaders;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#cookies = options.cookies;
    this.#etagLimit = options.etagCacheSize ?? 16;
    this.#forwardedFor = options.forwardedFor;
  }

  get forwardedFor(): string | undefined {
    return this.#forwardedFor;
  }

  set forwardedFor(value: string | undefined) {
    this.#forwardedFor = value;
  }

  /** Forget every cached ETag. */
  clearEtags(): void {
    this.#etags = null;
  }

  async request<T = unknown>(
    options: HttpRequestOptions,
  ): Promise<HttpResponse<T>> {
    const { method, name } = options;
    const path = this.#basePath + withQuery(options.path, options.query);
    const headers: Record<string, string> =
      this.#defaultHeaders === undefined ? {} : { ...this.#defaultHeaders };
    if (this.#cookies !== undefined) {
      const cookie = this.#cookies.header();
      if (cookie !== '') {
        headers.cookie = cookie;
      }
    }
    if (this.#forwardedFor !== undefined) {
      headers['x-forwarded-for'] = this.#forwardedFor;
    }
    if (method !== 'GET') {
      headers.origin = this.origin;
    }
    let body = options.body;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers['content-type'] = 'application/json';
    }
    const revalidate = options.etag === true && method === 'GET';
    const cached = revalidate ? this.#etags?.get(path) : undefined;
    if (cached !== undefined) {
      headers['if-none-match'] = cached.etag;
    }
    if (options.headers !== undefined) {
      Object.assign(headers, options.headers);
    }

    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(abortForTimeout, timeoutMs, controller, timeoutMs);
    const started = performance.now();
    let status = 0;
    let responseHeaders = EMPTY_HEADERS;
    let text = '';
    let failure: unknown = null;
    try {
      const response = await this.#agent.request({
        origin: this.origin,
        path,
        method,
        headers,
        body,
        signal: controller.signal,
      });
      status = response.statusCode;
      responseHeaders = response.headers;
      // Read the body to the end on every path: undici holds the socket
      // until the body is consumed or destroyed.
      text = await response.body.text();
    } catch (error) {
      failure = error;
    } finally {
      clearTimeout(timer);
    }
    const ms = performance.now() - started;

    if (failure !== null) {
      const errorKind = `net_${errorCode(failure)}`;
      this.#metrics.request(name, ms, 0);
      this.#metrics.error(
        name,
        errorKind,
        `${method} ${path}: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
      return new HttpResponse<T>({
        status: 0,
        ok: false,
        headers: EMPTY_HEADERS,
        ms,
        text: '',
        cacheHit: false,
        errorKind,
      });
    }

    this.#metrics.request(name, ms, status);
    if (this.#cookies !== undefined) {
      this.#cookies.setFromHeaders(responseHeaders['set-cookie']);
    }
    let cacheHit = false;
    if (status === 304 && cached !== undefined) {
      cacheHit = true;
      text = cached.text;
      this.#touch(path, cached);
    } else if (revalidate && status === 200) {
      const etag = responseHeaders.etag;
      if (typeof etag === 'string' && text.length <= ETAG_BODY_MAX) {
        this.#remember(path, { etag, text });
      }
    }
    const ok =
      options.expect === undefined
        ? (status >= 200 && status < 300) || status === 304
        : options.expect.includes(status);
    let errorKind: string | undefined;
    if (!ok) {
      errorKind = `http_${status}`;
      this.#metrics.error(
        name,
        errorKind,
        `${method} ${path} -> ${status}: ${text}`,
      );
    }
    return new HttpResponse<T>({
      status,
      ok,
      headers: responseHeaders,
      ms,
      text,
      cacheHit,
      errorKind,
    });
  }

  #touch(key: string, entry: EtagEntry): void {
    if (this.#etags === null) {
      return;
    }
    this.#etags.delete(key);
    this.#etags.set(key, entry);
  }

  #remember(key: string, entry: EtagEntry): void {
    if (this.#etagLimit <= 0) {
      return;
    }
    this.#etags ??= new Map();
    this.#etags.delete(key);
    this.#etags.set(key, entry);
    if (this.#etags.size > this.#etagLimit) {
      const oldest = this.#etags.keys().next();
      if (oldest.done !== true) {
        this.#etags.delete(oldest.value);
      }
    }
  }
}
