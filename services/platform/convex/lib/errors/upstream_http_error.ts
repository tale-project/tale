/**
 * Typed wrapper for non-2xx HTTP responses from upstream services
 * (RAG, Crawler). Centralizes:
 *
 * - Body truncation + secret scrubbing (via `sanitizeError`) so raw
 *   provider errors with embedded API keys, filenames, or stack
 *   fragments never reach a thrown Error message.
 * - `retryable` flag derived from status, so callers can decide
 *   without re-parsing the message.
 * - A `safeMessage` field with a user-presentable one-liner that
 *   omits the body snippet entirely; UI surfaces should prefer this.
 *
 * Use the static factory `UpstreamHttpError.fromResponse(...)`; raw
 * `new UpstreamHttpError({...})` is reserved for tests.
 */

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
}

/** Status codes the platform should retry on (transient upstream). */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status < 600);
}

function safeMessageFor(
  service: UpstreamService,
  status: number,
  endpoint: string,
): string {
  // User-facing summary: never includes body, never includes secrets.
  // Operators get the full picture from logs + the thrown Error message.
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

  constructor(init: UpstreamErrorInit) {
    // Engineer-facing message: includes the scrubbed snippet for log
    // triage. UI code MUST read `.safeMessage` instead of `.message`
    // to keep this snippet out of user-visible surfaces.
    const snippet = init.bodySnippet ? ` — ${init.bodySnippet}` : '';
    super(`${init.safeMessage}${snippet}`);
    this.name = 'UpstreamHttpError';
    this.service = init.service;
    this.status = init.status;
    this.endpoint = init.endpoint;
    this.bodySnippet = init.bodySnippet;
    this.retryable = init.retryable;
    this.safeMessage = init.safeMessage;
  }

  /**
   * Build an UpstreamHttpError from a non-2xx Response and its already-read
   * body text. Callers should always `await response.text()` first (don't
   * pass the unread Response — single-use body).
   */
  static fromResponse(
    service: UpstreamService,
    response: Response,
    bodyText: string,
    endpoint: string,
  ): UpstreamHttpError {
    return new UpstreamHttpError({
      service,
      status: response.status,
      endpoint,
      bodySnippet: sanitizeError(bodyText, BODY_SNIPPET_MAX),
      retryable: isRetryableStatus(response.status),
      safeMessage: safeMessageFor(service, response.status, endpoint),
    });
  }
}

/** Narrow `unknown` to UpstreamHttpError for catch-block branching. */
export function isUpstreamHttpError(err: unknown): err is UpstreamHttpError {
  return err instanceof UpstreamHttpError;
}
