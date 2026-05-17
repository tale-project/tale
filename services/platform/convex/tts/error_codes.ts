import { ConvexError } from 'convex/values';

import { SafeFetchError } from '../lib/http/safe_fetch';
import { NoProviderAvailableError } from '../providers/errors';

/**
 * Stable error tokens written to `ttsAudioChunks.error`. The client keys
 * recovery UX on these codes (e.g. surface "configure a provider" for
 * `NO_PROVIDER`, "tap to retry" for `RATE_LIMITED`, etc.) so producing them
 * correctly is part of the contract. The array is the single source of
 * truth — `schema.ts` builds its `error` field validator from it so the
 * persisted shape can never drift from the runtime classifier.
 *
 * Retry policy is owned by the client (use-voice-output.ts:33). The server
 * returns only the code; the client decides which codes are retryable
 * based on cost/idempotency trade-offs (no PROVIDER_5XX/TIMEOUT retry —
 * rebilling the provider on a degraded upstream is wasteful and adds
 * pressure during outages). Don't reintroduce a server-side `retryable`
 * flag without first reconciling the two sources of truth.
 */
export const ttsErrorCodeLiterals = [
  'NO_PROVIDER',
  'UNKNOWN_MODEL',
  'UNKNOWN_PROVIDER',
  'UNKNOWN_VOICE',
  'HOST_POLICY',
  'RATE_LIMITED',
  // Distinct from `RATE_LIMITED`: arises when the rate-limiter shard's
  // OCC retries exhaust under burst contention. The actual quota isn't
  // exhausted — the limiter just couldn't pick a free shard fast enough.
  // Client backs off much shorter (50-150ms jitter) than for `RATE_LIMITED`
  // (which honors the server's `retryAfter`).
  'CONTENTION',
  'BUDGET_EXCEEDED',
  // Kept for schema back-compat: reservation-throws bypass the classifier
  // (synthesize.ts intentionally does not catch them; the client handles
  // the ConvexError directly), but existing rows may carry this code and
  // removing it would fail the read validator.
  'MESSAGE_CHAR_LIMIT',
  'TIMEOUT',
  // Sub-buckets of 4xx so the UI can differentiate recoverable user-actions
  // (PROVIDER_AUTH → re-key; PROVIDER_PAYLOAD_TOO_LARGE → resegment;
  // PROVIDER_BAD_REQUEST → likely code bug). PROVIDER_4XX kept as the
  // generic fallback for unknown 4xx statuses.
  'PROVIDER_AUTH',
  'PROVIDER_BAD_REQUEST',
  'PROVIDER_PAYLOAD_TOO_LARGE',
  'PROVIDER_4XX',
  'PROVIDER_5XX',
  // Provider returned a 2xx response whose body is unusable (oversized
  // stream past the cap, or implausibly small / empty audio that would
  // bill for zero playable bytes). Distinct from `PROVIDER_4XX` because
  // there's no HTTP status to act on — the provider claimed success but
  // the response failed validation. UX is "retry later, may be a
  // transient upstream misconfiguration."
  'PROVIDER_INVALID_RESPONSE',
  'PROVIDER_ERROR',
  // Server-side watchdog flips a stuck-`pending` row to `failed` after
  // `PENDING_STALE_MS + TTS_WATCHDOG_BUFFER_MS`. UX treats this as a
  // transient PROVIDER_ERROR-equivalent.
  'WATCHDOG_TIMEOUT',
] as const;

export type TtsErrorCode = (typeof ttsErrorCodeLiterals)[number];

export interface ClassifiedFailure {
  code: TtsErrorCode;
  /**
   * Provider-supplied retry hint in milliseconds, threaded from the
   * upstream `Retry-After` header on 429 responses or `ConvexError.data`
   * on rate-limiter throws. The client's retry-loop prefers this over its
   * jittered backoff when present.
   */
  retryAfterMs?: number;
}

/**
 * Parse an HTTP `Retry-After` header value (RFC 7231) into milliseconds.
 * Accepts the `delta-seconds` form (`"5"`) and the `HTTP-date` form
 * (`"Wed, 21 Oct 2026 07:28:00 GMT"`). Returns `undefined` for malformed
 * input or negative deltas — the caller falls back to its default backoff.
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds) || seconds < 0) return undefined;
    return seconds * 1000;
  }
  const epoch = Date.parse(trimmed);
  if (Number.isNaN(epoch)) return undefined;
  const delta = epoch - Date.now();
  return delta > 0 ? delta : undefined;
}

/**
 * Error subclass carrying provider HTTP context (status + retry hint).
 * `synthesize.ts` throws this on non-2xx provider responses instead of a
 * bare `Error(`TTS API \${status}: ...`)` so `errorCodeFromCaught` can
 * read the status directly and capture `Retry-After` without a regex on
 * `.message`.
 */
export class TtsProviderHttpError extends Error {
  override readonly name = 'TtsProviderHttpError';
  constructor(
    public readonly status: number,
    public readonly retryAfterMs: number | undefined,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Classify a thrown error into a stable `TtsErrorCode`.
 *
 * Critical: `NoProviderAvailableError` does NOT survive `ctx.runAction`
 * boundaries — Convex reserializes it as a plain `Error` whose message
 * starts with `"Uncaught NoProviderAvailableError: ..."`. Match both
 * `instanceof` and the lowercased message substring (mirrors the existing
 * pattern in `providers/errors.ts::shouldAttemptFailover`).
 *
 * Pure function — no Convex runtime dependencies — so a Node-context
 * action and a Vitest unit test can both import it.
 */
export function errorCodeFromCaught(err: unknown): ClassifiedFailure {
  if (err instanceof NoProviderAvailableError) {
    return { code: 'NO_PROVIDER' };
  }
  const rawMessage =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err).toLowerCase();
  if (rawMessage.includes('noprovideravailableerror')) {
    return { code: 'NO_PROVIDER' };
  }
  if (err instanceof ConvexError) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError.data is typed as `any`; we only read `code`/`retryAfterMs` defensively
    const data = err.data as
      | { code?: string; retryAfterMs?: number; retryAfter?: number }
      | undefined;
    const code = data?.code;
    // The rate-limiter sets `retryAfter` (seconds) or `retryAfterMs`; honor
    // either so the client's retry-loop gets the same hint regardless of
    // which path filled the ConvexError.
    const retryAfterMs =
      typeof data?.retryAfterMs === 'number'
        ? data.retryAfterMs
        : typeof data?.retryAfter === 'number'
          ? data.retryAfter * 1000
          : undefined;
    if (code === 'UNKNOWN_MODEL') {
      return { code: 'UNKNOWN_MODEL' };
    }
    if (code === 'UNKNOWN_PROVIDER') {
      return { code: 'UNKNOWN_PROVIDER' };
    }
    if (code === 'RATE_LIMITED') {
      return { code: 'RATE_LIMITED', retryAfterMs };
    }
    if (code === 'BUDGET_EXCEEDED') {
      return { code: 'BUDGET_EXCEEDED' };
    }
    if (code === 'MESSAGE_CHAR_LIMIT') {
      return { code: 'MESSAGE_CHAR_LIMIT' };
    }
    // `checkProviderHostPolicy` raises these three codes; without explicit
    // branches they fall through to `PROVIDER_ERROR` and the client's
    // `HOST_POLICY` recovery affordance never fires.
    if (
      code === 'INVALID_URL' ||
      code === 'BLOCKED_HOST' ||
      code === 'PRIVATE_HOST_BLOCKED'
    ) {
      return { code: 'HOST_POLICY' };
    }
  }
  // `safeFetchBinary` surfaces SSRF / redirect / size violations as
  // `SafeFetchError`; classify by `kind` so retry decisions and recovery
  // UX match the real failure mode.
  if (err instanceof SafeFetchError) {
    switch (err.kind) {
      case 'invalid_url':
      case 'unsupported_protocol':
      case 'private_ip':
      case 'insecure_public_http':
      case 'redirect_missing_location':
      case 'redirect_limit_exceeded':
        return { code: 'HOST_POLICY' };
      case 'response_too_large':
      case 'response_too_small':
        // Both arise on a 2xx response (streaming cap trip, or pre-store
        // size check on a near-empty body). There is no 4xx status to act
        // on, so PROVIDER_4XX is the wrong bucket — surface the distinct
        // INVALID_RESPONSE code so the UI message names the actual
        // failure mode ("provider returned invalid audio").
        return { code: 'PROVIDER_INVALID_RESPONSE' };
      case 'timeout':
        return { code: 'TIMEOUT' };
      case 'network_error':
        return { code: 'PROVIDER_ERROR' };
    }
  }
  // Same-action throws from resolveTtsModel use `new Error('UNKNOWN_VOICE: ...')`.
  if (err instanceof Error && err.message.startsWith('UNKNOWN_VOICE:')) {
    return { code: 'UNKNOWN_VOICE' };
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return { code: 'TIMEOUT' };
  }
  // Upstream provider HTTP error — `synthesizeChunk` throws TtsProviderHttpError
  // on non-2xx provider responses; classify by status. 401/403 are terminal
  // (re-key needed); 400/422 indicate bad request shape; 413 indicates
  // payload too large (caller could resegment); 5xx is transient.
  if (err instanceof TtsProviderHttpError) {
    return classifyProviderHttpStatus(err.status, err.retryAfterMs);
  }
  // Back-compat path: legacy `new Error('TTS API ${status}: ...')` shape may
  // still surface from helpers that haven't migrated. Drop after one release.
  if (err instanceof Error) {
    const m = err.message.match(/^TTS API (\d{3}):/);
    if (m) {
      return classifyProviderHttpStatus(Number(m[1]), undefined);
    }
  }
  return { code: 'PROVIDER_ERROR' };
}

function classifyProviderHttpStatus(
  status: number,
  retryAfterMs: number | undefined,
): ClassifiedFailure {
  if (status === 429) {
    return { code: 'RATE_LIMITED', retryAfterMs };
  }
  if (status === 401 || status === 403) {
    return { code: 'PROVIDER_AUTH' };
  }
  if (status === 413) {
    return { code: 'PROVIDER_PAYLOAD_TOO_LARGE' };
  }
  if (status === 400 || status === 422) {
    return { code: 'PROVIDER_BAD_REQUEST' };
  }
  if (status >= 500) {
    return { code: 'PROVIDER_5XX' };
  }
  return { code: 'PROVIDER_4XX' };
}
