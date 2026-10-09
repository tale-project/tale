/**
 * The seed's own small HTTP client: undici `request()` over one keep-alive
 * pool, the `Origin` header Better Auth's origin check wants on every write,
 * cookie capture from `Set-Cookie`, and a retry loop with backoff that
 * honours `Retry-After`.
 *
 * The seed deliberately does not share the load driver's client: it needs
 * none of the driver's measurement, and keeping it private means the two can
 * evolve without one breaking the other.
 */

// The explicit file, not the bare `undici`: Bun answers the bare specifier
// with its own partial stub, and the seed's tests run under Bun. Node
// resolves both to the same package.
import { Agent, request } from 'undici/index.js';

export type SeedMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface SeedRequest {
  method: SeedMethod;
  /** Path below the target, e.g. `/api/app/projects`. */
  path: string;
  query?: Record<string, string>;
  /** Sent as `application/json`. */
  json?: unknown;
  /** A ready `Cookie` header value. */
  cookie?: string;
  headers?: Record<string, string>;
}

export interface SeedResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** Parsed JSON when the body is JSON, else `null`. */
  body: unknown;
  text: string;
}

/** Statuses worth another attempt: throttling and transient server faults. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** A non-2xx answer, with enough context to report it per organization. */
export class SeedHttpError extends Error {
  readonly status: number;
  readonly method: SeedMethod;
  readonly path: string;
  readonly body: unknown;
  readonly retryAfterMs: number | null;

  constructor(req: SeedRequest, res: SeedResponse) {
    const detail =
      res.text.length > 300 ? `${res.text.slice(0, 300)}…` : res.text;
    super(`${req.method} ${req.path} answered ${res.status}: ${detail}`);
    this.name = 'SeedHttpError';
    this.status = res.status;
    this.method = req.method;
    this.path = req.path;
    this.body = res.body;
    this.retryAfterMs = parseRetryAfter(
      headerValue(res.headers, 'retry-after'),
    );
  }

  get retryable(): boolean {
    return RETRYABLE_STATUSES.has(this.status);
  }
}

/** First value of a header that may be repeated. */
function headerValue(
  headers: SeedResponse['headers'],
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** `Retry-After` in milliseconds (seconds or an HTTP date), or `null`. */
export function parseRetryAfter(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/**
 * The `name=value` pairs of `Set-Cookie` headers. Attributes are dropped: the
 * seed replays cookies to one origin for minutes, so expiry and path never
 * matter. A cookie cleared by the server (empty value) is dropped as well.
 */
export function cookiesFromSetCookie(
  header: string | string[] | undefined,
): Map<string, string> {
  const jar = new Map<string, string>();
  if (header === undefined) return jar;
  for (const line of Array.isArray(header) ? header : [header]) {
    const pair = line.split(';', 1)[0] ?? '';
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === '') jar.delete(name);
    else jar.set(name, value);
  }
  return jar;
}

/** A `Cookie` header from a jar. */
export function cookieHeader(jar: ReadonlyMap<string, string>): string {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

export interface SeedHttpOptions {
  target: string;
  /** `Origin` sent on writes; defaults to the target's origin. */
  origin?: string;
  /** Upper bound on pooled connections. */
  connections: number;
  /** Per-request budget, headers and body together. */
  timeoutMs?: number;
}

export class SeedHttp {
  readonly target: string;
  readonly origin: string;
  private readonly agent: Agent;
  private readonly timeoutMs: number;

  constructor(options: SeedHttpOptions) {
    this.target = options.target.replace(/\/+$/, '');
    this.origin = new URL(options.origin ?? this.target).origin;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.agent = new Agent({
      connections: options.connections,
      keepAliveTimeout: 30_000,
      headersTimeout: this.timeoutMs,
      bodyTimeout: this.timeoutMs,
    });
  }

  /** One request; a non-2xx status is returned, a network fault throws. */
  async send(req: SeedRequest): Promise<SeedResponse> {
    const url = new URL(req.path, `${this.target}/`);
    for (const [key, value] of Object.entries(req.query ?? {})) {
      url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
      ...req.headers,
    };
    if (req.method !== 'GET') headers.origin = this.origin;
    if (req.cookie !== undefined) headers.cookie = req.cookie;
    let body: string | undefined;
    if (req.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(req.json);
    }
    const res = await request(url, {
      method: req.method,
      headers,
      body,
      dispatcher: this.agent,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.body.text();
    let parsed: unknown = null;
    const type = headerValue(res.headers, 'content-type') ?? '';
    if (type.includes('json') && text !== '') {
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        console.warn(
          `[seed] ${req.method} ${req.path}: unparseable JSON body (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    return { status: res.statusCode, headers: res.headers, body: parsed, text };
  }

  /** One request that must answer 2xx; the parsed body is returned. */
  async json(req: SeedRequest): Promise<unknown> {
    const res = await this.send(req);
    if (res.status < 200 || res.status >= 300)
      throw new SeedHttpError(req, res);
    return res.body;
  }

  async close(): Promise<void> {
    await this.agent.close();
  }
}

export interface RetryOptions {
  /** Total attempts, the first included. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Extra errors worth another attempt (a version conflict, say). */
  retryIf?: (error: unknown) => boolean;
}

/** The longest a server-sent `Retry-After` may hold one attempt back. */
const MAX_HINTED_DELAY_MS = 120_000;

/** Whether an error is worth another attempt: transient status or network. */
function isRetryable(error: unknown): boolean {
  if (error instanceof SeedHttpError) return error.retryable;
  // Anything else thrown by undici is a transport fault (reset, timeout,
  // refused), which a restarting or overloaded backend produces.
  return error instanceof Error;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` until it succeeds, a non-retryable error surfaces, or the attempts
 * run out. Delays grow exponentially with full jitter, and a `Retry-After`
 * the server sent wins over the computed delay.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 6;
  const base = options.baseDelayMs ?? 250;
  const cap = options.maxDelayMs ?? 15_000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      const retryable =
        isRetryable(error) || (options.retryIf?.(error) ?? false);
      if (attempt >= attempts || !retryable) throw error;
      const hinted = error instanceof SeedHttpError ? error.retryAfterMs : null;
      const computed = Math.random() * Math.min(cap, base * 2 ** (attempt - 1));
      await sleep(Math.min(hinted ?? computed, MAX_HINTED_DELAY_MS));
    }
  }
}
