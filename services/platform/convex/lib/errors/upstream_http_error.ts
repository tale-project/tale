/**
 * Typed wrapper for non-2xx HTTP responses from upstream services
 * (RAG, Crawler). Centralizes:
 *
 * - Body truncation + secret scrubbing (via `sanitizeError`) so raw
 *   provider errors with embedded API keys, filenames, or stack
 *   fragments never reach a thrown Error message.
 * - `retryable` flag derived from status, so callers can decide
 *   without re-parsing the message.
 * - `Retry-After` parsing — set on `retryAfterMs` when the upstream
 *   provided one and we should honor it before retrying.
 * - A `safeMessage` field with a user-presentable one-liner that
 *   omits the body snippet entirely. `.message` equals `.safeMessage`
 *   so that the default error surfacing across the Convex client
 *   boundary (which only carries `error.message`) does not leak the
 *   raw body to UI toasts. Engineers reading server logs should
 *   inspect `.bodySnippet` for the scrubbed body excerpt.
 *
 * Use the static factory `UpstreamHttpError.fromResponse(...)`; raw
 * `new UpstreamHttpError({...})` is reserved for tests.
 */

import { ConvexError } from 'convex/values';

import { sanitizeError } from '../utils/sanitize_secrets';

export type UpstreamService = 'rag' | 'crawler';

const BODY_SNIPPET_MAX = 400;

export interface UpstreamErrorInit {
  service: UpstreamService;
  status: number;
  endpoint: string;
  bodySnippet: string;
  retryable: boolean;
  safeMessage: string;
  retryAfterMs?: number;
}

/** Status codes the platform should retry on (transient upstream). */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

/**
 * Parse the upstream `Retry-After` header into milliseconds. Supports
 * both the integer-seconds and HTTP-date forms per RFC 9110 §10.2.3.
 * Returns `undefined` when the header is missing or unparseable so
 * callers can fall back to a default backoff.
 */
export function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const asInt = Number(trimmed);
  if (Number.isFinite(asInt) && asInt >= 0) {
    return Math.round(asInt * 1000);
  }
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}

function safeMessageFor(
  service: UpstreamService,
  status: number,
  endpoint: string,
): string {
  // User-facing summary: never includes body, never includes secrets.
  // Operators get the full picture from logs + .bodySnippet.
  const where = `${service.toUpperCase()} ${endpoint}`;
  if (status === 401 || status === 403) {
    return `${where} authentication failed (HTTP ${status}).`;
  }
  if (status === 404) {
    return `${where} returned not found (HTTP 404).`;
  }
  if (status === 408 || status === 429) {
    return `${where} is throttling (HTTP ${status}); retry shortly.`;
  }
  if (status >= 500) {
    return `${where} is unavailable (HTTP ${status}); retry shortly.`;
  }
  return `${where} returned HTTP ${status}.`;
}

export class UpstreamHttpError extends Error {
  readonly service: UpstreamService;
  readonly status: number;
  readonly endpoint: string;
  readonly bodySnippet: string;
  readonly retryable: boolean;
  readonly safeMessage: string;
  readonly retryAfterMs?: number;

  constructor(init: UpstreamErrorInit) {
    // `.message` carries the safe summary only. The body snippet lives
    // in a separate field that server-side logs can include explicitly.
    // This keeps the snippet out of the Convex client-boundary error
    // shape, which only preserves `error.message`.
    super(init.safeMessage);
    this.name = 'UpstreamHttpError';
    this.service = init.service;
    this.status = init.status;
    this.endpoint = init.endpoint;
    this.bodySnippet = init.bodySnippet;
    this.retryable = init.retryable;
    this.safeMessage = init.safeMessage;
    if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs;
  }

  /**
   * Build an UpstreamHttpError from a non-2xx Response and its already-read
   * body text. Callers should always `await response.text()` first (don't
   * pass the unread Response — single-use body).
   *
   * `endpoint` defaults to `response.url` so callers no longer have to
   * pass the URL twice.
   */
  static fromResponse(
    service: UpstreamService,
    response: Response,
    bodyText: string,
    endpoint?: string,
  ): UpstreamHttpError {
    const ep = endpoint ?? response.url;
    // `response.headers` is always set on a real `Response`, but unit
    // tests mock the response shape as a bare object and may omit
    // headers. Defensive `?.` so the helper still produces a usable
    // error in those cases (retryAfterMs stays undefined).
    const retryAfter =
      typeof response.headers?.get === 'function'
        ? response.headers.get('retry-after')
        : null;
    return new UpstreamHttpError({
      service,
      status: response.status,
      endpoint: ep,
      bodySnippet: sanitizeError(bodyText, BODY_SNIPPET_MAX),
      retryable: isRetryableStatus(response.status),
      safeMessage: safeMessageFor(service, response.status, ep),
      retryAfterMs: parseRetryAfterMs(retryAfter),
    });
  }

  /**
   * Convert to a `ConvexError` that carries the structured fields
   * across the Convex client boundary. Plain Error subclasses lose
   * their `.bodySnippet` / `.retryable` / `.status` on the wire —
   * Convex only marshals `ConvexError.data`. Use this when throwing
   * from an action that an end-user-facing flow consumes.
   */
  toConvexError(): ConvexError<{
    code: 'upstream_http';
    service: UpstreamService;
    status: number;
    retryable: boolean;
    safeMessage: string;
    retryAfterMs?: number;
  }> {
    const data: {
      code: 'upstream_http';
      service: UpstreamService;
      status: number;
      retryable: boolean;
      safeMessage: string;
      retryAfterMs?: number;
    } = {
      code: 'upstream_http',
      service: this.service,
      status: this.status,
      retryable: this.retryable,
      safeMessage: this.safeMessage,
    };
    if (this.retryAfterMs !== undefined) data.retryAfterMs = this.retryAfterMs;
    return new ConvexError(data);
  }
}

/** Narrow `unknown` to UpstreamHttpError for catch-block branching. */
export function isUpstreamHttpError(err: unknown): err is UpstreamHttpError {
  return err instanceof UpstreamHttpError;
}
