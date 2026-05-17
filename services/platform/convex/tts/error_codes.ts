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
  'MESSAGE_CHAR_LIMIT',
  'TIMEOUT',
  'PROVIDER_4XX',
  'PROVIDER_5XX',
  'PROVIDER_ERROR',
] as const;

export type TtsErrorCode = (typeof ttsErrorCodeLiterals)[number];

export interface ClassifiedFailure {
  code: TtsErrorCode;
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError.data is typed as `any`; we only read `code` defensively
    const data = err.data as { code?: string } | undefined;
    const code = data?.code;
    if (code === 'UNKNOWN_MODEL') {
      return { code: 'UNKNOWN_MODEL' };
    }
    if (code === 'UNKNOWN_PROVIDER') {
      return { code: 'UNKNOWN_PROVIDER' };
    }
    if (code === 'RATE_LIMITED') {
      return { code: 'RATE_LIMITED' };
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
        return { code: 'PROVIDER_4XX' };
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
  // Upstream provider HTTP error — `synthesizeChunk` rethrows these with the
  // `TTS API ${status}: ...` shape so we can split 4xx (terminal) vs 5xx
  // (retryable). 401 in particular must be terminal — retrying won't fix
  // a bad API key.
  if (err instanceof Error) {
    const m = err.message.match(/^TTS API (\d{3}):/);
    if (m) {
      const status = Number(m[1]);
      if (status === 429) {
        return { code: 'RATE_LIMITED' };
      }
      if (status >= 500) {
        return { code: 'PROVIDER_5XX' };
      }
      return { code: 'PROVIDER_4XX' };
    }
  }
  return { code: 'PROVIDER_ERROR' };
}
