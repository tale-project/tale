/**
 * The request layer every API wrapper goes through.
 *
 * A wrapper names its request by the ROUTE TEMPLATE it hits (`POST
 * /api/app/chat/threads/:id/messages`), so the report groups every user's
 * calls to one route however their ids differ. It declares which non-2xx
 * answers are refusals it understands (a busy thread's 409, a missing object
 * store's 503): those are expected outcomes, counted by status, never errors.
 * Anything else unexpected is recorded as an error by the HTTP client.
 *
 * Two cross-cutting concerns live here rather than in each wrapper:
 *
 * - every response is shown to an observer, which is how a virtual user
 *   learns that its session lapsed (401), that it is being rate limited
 *   (429 with `Retry-After`) or that the server is failing (5xx), and backs
 *   off the way a person retrying would;
 * - the user's abort signal: a request still in flight when the user is
 *   stopped is abandoned (its result still lands in the metrics when it
 *   completes), so a user winds down promptly even mid chat turn.
 */

import type {
  HttpRequestOptions,
  HttpResponse,
  QueryValue,
} from '../client/index.ts';
import { MetricsRegistry } from '../metrics/index.ts';

/** Anything that issues a recorded request: a `UserSession`, an `HttpClient`. */
export interface Requester {
  request<T = unknown>(options: HttpRequestOptions): Promise<HttpResponse<T>>;
}

/** Sees every completed response (not abandoned ones). */
export interface ApiObserver {
  onResponse(name: string, response: HttpResponse<unknown>): void;
}

/** Statuses that are success for every wrapper. */
const SUCCESS_STATUSES: readonly number[] = [200, 201, 202, 203, 204, 206, 304];

/**
 * Refusals every wrapper accepts without counting an error: the platform's
 * rate limiters answer 429 on many doors, and a person meeting one waits
 * and tries again — the observer turns it into a back-off.
 */
const DEFAULT_REFUSALS: readonly number[] = [429];

export interface CallOptions extends Omit<HttpRequestOptions, 'expect'> {
  /** Non-2xx statuses this call handles as an outcome, not an error. */
  refusals?: readonly number[];
  /**
   * Replace the expected set entirely (the fuzzer's posture). When given,
   * `refusals` and the defaults are ignored.
   */
  expect?: readonly number[];
}

export interface ApiResult<T> {
  /** HTTP status; `0` for a network failure or an abandoned request. */
  readonly status: number;
  /** A 2xx (or 304). */
  readonly ok: boolean;
  /** The parsed body of a successful answer. */
  readonly body: T | undefined;
  /** The machine code an error envelope carried, when it carried one. */
  readonly code: string | undefined;
  /** The raw response; `null` when the request was abandoned. */
  readonly response: HttpResponse<unknown> | null;
  /** Abandoned because the user was stopped. */
  readonly aborted: boolean;
}

const ABORTED: ApiResult<never> = Object.freeze({
  status: 0,
  ok: false,
  body: undefined,
  code: undefined,
  response: null,
  aborted: true,
});

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,}$/;

/**
 * The machine code of an error envelope: `code` when it is a string, else
 * `error` when that reads like a code (`OBJECT_STORE_UNCONFIGURED`), not a
 * sentence. Both envelopes the platform speaks carry one of the two.
 */
export function errorCodeOf(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const code: unknown = Reflect.get(body, 'code');
  if (typeof code === 'string' && code !== '') return code;
  const error: unknown = Reflect.get(body, 'error');
  if (typeof error === 'string' && CODE_PATTERN.test(error)) return error;
  return undefined;
}

function isSuccess(status: number): boolean {
  return (status >= 200 && status < 300) || status === 304;
}

/** Resolves `null` once `signal` aborts; `cleanup` removes the listener. */
function abortRace(signal: AbortSignal): {
  promise: Promise<null>;
  cleanup: () => void;
} {
  let onAbort: (() => void) | null = null;
  const promise = new Promise<null>((resolve) => {
    onAbort = () => resolve(null);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  return {
    promise,
    cleanup: () => {
      if (onAbort !== null) signal.removeEventListener('abort', onAbort);
    },
  };
}

export interface ApiClientOptions {
  requester: Requester;
  signal?: AbortSignal;
  observer?: ApiObserver;
  /** Default per-call refusals; {@link DEFAULT_REFUSALS} when absent. */
  defaultRefusals?: readonly number[];
}

export class ApiClient {
  readonly #requester: Requester;
  readonly #signal: AbortSignal | undefined;
  readonly #observer: ApiObserver | undefined;
  readonly #defaultRefusals: readonly number[];

  constructor(options: ApiClientOptions) {
    this.#requester = options.requester;
    this.#signal = options.signal;
    this.#observer = options.observer;
    this.#defaultRefusals = options.defaultRefusals ?? DEFAULT_REFUSALS;
  }

  async call<T>(options: CallOptions): Promise<ApiResult<T>> {
    const signal = this.#signal;
    if (signal?.aborted === true) return ABORTED;
    const { refusals, expect, ...rest } = options;
    const expected = expect ?? [
      ...SUCCESS_STATUSES,
      ...this.#defaultRefusals,
      ...(refusals ?? []),
    ];
    const pending = this.#requester.request<unknown>({
      ...rest,
      expect: expected,
    });
    let response: HttpResponse<unknown> | null;
    if (signal === undefined) {
      response = await pending;
    } else {
      const race = abortRace(signal);
      try {
        response = await Promise.race([pending, race.promise]);
      } finally {
        race.cleanup();
      }
    }
    if (response === null) return ABORTED;
    this.#observer?.onResponse(options.name, response);
    const ok = isSuccess(response.status);
    const parsed = response.json();
    return {
      status: response.status,
      ok,
      body: ok ? (parsed as T | undefined) : undefined,
      code: ok ? undefined : errorCodeOf(parsed),
      response,
      aborted: false,
    };
  }
}

/**
 * Where held requests' HTTP-level records go: nowhere anyone reads. A short
 * retention keeps its rolling windows from growing over a long run.
 */
const DISCARDED = new MetricsRegistry({ retentionMs: 10_000 });

/** A client for {@link HeldRequester}, recording into the discard sink. */
export function discardingMetrics(): MetricsRegistry {
  return DISCARDED;
}

/**
 * A request held open for a whole operation — the chat send, which answers
 * only when the turn settles. Its duration is the operation's, not an HTTP
 * round trip's, so it is recorded as a TIMING under the route's name (with
 * its status and any error, exactly as the client would): it must not sit in
 * the `http` latency aggregate, where every turn would read as a multi-second
 * request. The inner requester must record into {@link discardingMetrics}.
 */
export class HeldRequester implements Requester {
  readonly #inner: Requester;
  readonly #metrics: MetricsRegistry;

  constructor(inner: Requester, metrics: MetricsRegistry) {
    this.#inner = inner;
    this.#metrics = metrics;
  }

  async request<T = unknown>(
    options: HttpRequestOptions,
  ): Promise<HttpResponse<T>> {
    const response = await this.#inner.request<T>(options);
    this.#metrics.timing(options.name, response.ms);
    this.#metrics.status(options.name, response.status);
    if (response.errorKind !== undefined) {
      this.#metrics.error(
        options.name,
        response.errorKind,
        `${options.method} ${options.path} -> ${response.status}: ${response.text}`,
      );
    }
    return response;
  }
}

/** `{ orgId, ...extra }`, dropping undefined values. */
export function orgQuery(
  orgId: string,
  extra: Record<string, QueryValue> = {},
): Record<string, QueryValue> {
  return { ...extra, orgId };
}

// ---------------------------------------------------------------------------
// Defensive readers: a load generator must survive any body the server sends.
// ---------------------------------------------------------------------------

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `body[key]` as an array of records (rows of a list answer). */
export function rowsOf(body: unknown, key: string): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (const item of asArray(asRecord(body)?.[key])) {
    const row = asRecord(item);
    if (row !== undefined) rows.push(row);
  }
  return rows;
}

/** The string ids of list rows (`id`, or `_id` for 0.4-shaped rows). */
export function idsOf(rows: readonly Record<string, unknown>[]): string[] {
  const ids: string[] = [];
  for (const row of rows) {
    const id = asString(row.id) ?? asString(row._id);
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/** Map an `ApiResult` body through `read`, keeping the transport fields. */
export function mapResult<T, U>(
  result: ApiResult<T>,
  read: (body: T) => U | undefined,
): ApiResult<U> {
  return {
    status: result.status,
    ok: result.ok,
    body: result.body === undefined ? undefined : read(result.body),
    code: result.code,
    response: result.response,
    aborted: result.aborted,
  };
}
