'use node';

import { ConvexError, v } from 'convex/values';

import { MAX_TTS_CHUNK_CHARS } from '../../lib/shared/constants/tts';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { estimateTtsCostCents } from '../governance/cost_estimation';
import { SafeFetchError, safeFetchBinary } from '../lib/http/safe_fetch';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { NoProviderAvailableError } from '../providers/errors';
import { checkProviderHostPolicy } from '../providers/file_actions';
import { resolveTtsModel } from '../providers/resolve_model';

const FETCH_TIMEOUT_MS = 60_000;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB hard cap on provider response

const AUDIO_MIME_BY_FORMAT: Record<string, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg; codecs=opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/L16; rate=24000',
};

/**
 * Stable error tokens written to `ttsAudioChunks.error`. The client keys
 * recovery UX on these codes (e.g. surface "configure a provider" for
 * `NO_PROVIDER`, "tap to retry" for `RATE_LIMITED`, etc.) so producing them
 * correctly is part of the contract — see `errorCodeFromCaught`.
 */
type TtsErrorCode =
  | 'NO_PROVIDER'
  | 'UNKNOWN_MODEL'
  | 'UNKNOWN_PROVIDER'
  | 'UNKNOWN_VOICE'
  | 'HOST_POLICY'
  | 'RATE_LIMITED'
  // Distinct from `RATE_LIMITED`: arises when the rate-limiter shard's
  // OCC retries exhaust under burst contention. The actual quota isn't
  // exhausted — the limiter just couldn't pick a free shard fast enough.
  // Client backs off much shorter (50-150ms jitter) than for `RATE_LIMITED`
  // (which honors the server's `retryAfter`).
  | 'CONTENTION'
  | 'BUDGET_EXCEEDED'
  | 'MESSAGE_CHAR_LIMIT'
  | 'TIMEOUT'
  | 'PROVIDER_4XX'
  | 'PROVIDER_5XX'
  | 'PROVIDER_ERROR';

interface ClassifiedFailure {
  code: TtsErrorCode;
  retryable: boolean;
  detail: string;
}

/**
 * Classify a thrown error into a stable `TtsErrorCode` + sanitized detail.
 *
 * Critical: `NoProviderAvailableError` does NOT survive `ctx.runAction`
 * boundaries — Convex reserializes it as a plain `Error` whose message
 * starts with `"Uncaught NoProviderAvailableError: ..."`. Match both
 * `instanceof` and the lowercased message substring (mirrors the existing
 * pattern in `providers/errors.ts::shouldAttemptFailover`).
 */
function errorCodeFromCaught(err: unknown): ClassifiedFailure {
  const detail = sanitizeError(err);
  if (err instanceof NoProviderAvailableError) {
    return { code: 'NO_PROVIDER', retryable: false, detail };
  }
  const rawMessage =
    err instanceof Error
      ? err.message.toLowerCase()
      : String(err).toLowerCase();
  if (rawMessage.includes('noprovideravailableerror')) {
    return { code: 'NO_PROVIDER', retryable: false, detail };
  }
  if (err instanceof ConvexError) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ConvexError.data is typed as `any`; we only read `code` defensively
    const data = err.data as { code?: string } | undefined;
    const code = data?.code;
    if (code === 'UNKNOWN_MODEL') {
      return { code: 'UNKNOWN_MODEL', retryable: false, detail };
    }
    if (code === 'UNKNOWN_PROVIDER') {
      return { code: 'UNKNOWN_PROVIDER', retryable: false, detail };
    }
    if (code === 'RATE_LIMITED') {
      return { code: 'RATE_LIMITED', retryable: true, detail };
    }
    if (code === 'BUDGET_EXCEEDED') {
      return { code: 'BUDGET_EXCEEDED', retryable: false, detail };
    }
    if (code === 'MESSAGE_CHAR_LIMIT') {
      return { code: 'MESSAGE_CHAR_LIMIT', retryable: false, detail };
    }
    // `checkProviderHostPolicy` raises these three codes; without explicit
    // branches they fall through to `PROVIDER_ERROR` and the client's
    // `HOST_POLICY` recovery affordance never fires.
    if (
      code === 'INVALID_URL' ||
      code === 'BLOCKED_HOST' ||
      code === 'PRIVATE_HOST_BLOCKED'
    ) {
      return { code: 'HOST_POLICY', retryable: false, detail };
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
      case 'redirect_missing_location':
      case 'redirect_limit_exceeded':
        return { code: 'HOST_POLICY', retryable: false, detail };
      case 'response_too_large':
        return { code: 'PROVIDER_4XX', retryable: false, detail };
      case 'timeout':
        return { code: 'TIMEOUT', retryable: true, detail };
      case 'upstream_error':
      case 'network_error':
        return { code: 'PROVIDER_ERROR', retryable: false, detail };
    }
  }
  // Same-action throws from resolveTtsModel use `new Error('UNKNOWN_VOICE: ...')`.
  if (err instanceof Error && err.message.startsWith('UNKNOWN_VOICE:')) {
    return { code: 'UNKNOWN_VOICE', retryable: false, detail };
  }
  if (err instanceof Error && err.name === 'AbortError') {
    return { code: 'TIMEOUT', retryable: true, detail };
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
        return { code: 'RATE_LIMITED', retryable: true, detail };
      }
      if (status >= 500) {
        return { code: 'PROVIDER_5XX', retryable: true, detail };
      }
      return { code: 'PROVIDER_4XX', retryable: false, detail };
    }
  }
  return { code: 'PROVIDER_ERROR', retryable: false, detail };
}

/**
 * Synthesize one sentence/paragraph chunk of an assistant message. Client
 * calls this in order as it segments the streaming text; the action is
 * idempotent on `(messageId, index)` so re-tries and multi-tab races are
 * safe.
 *
 * Auth and quota gating live in `reserveChunk` — that mutation authenticates
 * the caller, asserts thread access, derives the canonical `organizationId`
 * from thread metadata, enforces per-user + per-org rate limits, consults
 * the org budget policy, and caps chunks per message. The action itself only
 * makes the upstream HTTP call once `reserveChunk` returns `'reserved'`.
 *
 * On success, the action also records the synthesis to `usageLedger` so it
 * counts against the org's budget envelope.
 *
 * Stable failure codes stored on the chunk row (`ttsAudioChunks.error`):
 *  - `NO_PROVIDER` / `UNKNOWN_PROVIDER` / `UNKNOWN_MODEL` / `UNKNOWN_VOICE`
 *    — provider configuration issue; client surfaces a settings link.
 *  - `HOST_POLICY` — provider baseUrl rejected by allowlist.
 *  - `RATE_LIMITED` — retry with backoff.
 *  - `BUDGET_EXCEEDED` — terminal; admin must lift budget.
 *  - `PROVIDER_4XX` / `PROVIDER_5XX` / `TIMEOUT` / `PROVIDER_ERROR` —
 *    classified for the client's retry decision.
 */
export const synthesizeChunk = action({
  args: {
    messageId: v.string(),
    threadId: v.string(),
    organizationId: v.string(),
    index: v.number(),
    text: v.string(),
    locale: v.string(),
  },
  returns: v.object({
    status: v.union(
      v.literal('ready'),
      v.literal('in-flight'),
      v.literal('failed'),
    ),
    errorCode: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    await requireAuthenticatedUser(ctx);
    const text = args.text.trim();
    if (text.length === 0) {
      throw new ConvexError({
        code: 'TTS_EMPTY_TEXT',
        message: 'Chunk text is empty after trim.',
      });
    }
    if (text.length > MAX_TTS_CHUNK_CHARS) {
      throw new ConvexError({
        code: 'TTS_TEXT_TOO_LONG',
        message: `Chunk text exceeds ${MAX_TTS_CHUNK_CHARS} characters; client must re-segment.`,
      });
    }

    // `reserveChunk` throws forbidden / rate-limit / budget / chunk-limit
    // errors. These are not chunk-row-recoverable (we don't own a chunkId
    // yet), so we don't catch them — the action surfaces them to the client
    // as a hard failure distinct from a chunk-level `failed` row, which
    // lets the UI render the right recovery affordance.
    //
    // Exception: an OptimisticConcurrencyControlFailure on the rate-limiter
    // shard can leak through when many concurrent callers contend on the
    // same shard and the library's internal OCC retries exhaust. The chunk
    // wasn't reserved, so we have no row to mark — surface as `CONTENTION`
    // (distinct from `RATE_LIMITED`) so the client backs off with the
    // short OCC jitter, not the full quota-recovery delay.
    const reservation = await ctx
      .runMutation(internal.tts.mutations.reserveChunk, {
        messageId: args.messageId,
        threadId: args.threadId,
        organizationId: args.organizationId,
        index: args.index,
        text,
        locale: args.locale,
      })
      .catch((err: unknown): { __occ: true } => {
        if (
          err instanceof Error &&
          /OptimisticConcurrencyControlFailure/.test(err.message)
        ) {
          return { __occ: true };
        }
        throw err;
      });
    if ('__occ' in reservation) {
      return { status: 'failed' as const, errorCode: 'CONTENTION' };
    }

    if (reservation.kind === 'ready') {
      return { status: 'ready' as const };
    }
    if (reservation.kind === 'pending-in-flight') {
      return { status: 'in-flight' as const };
    }
    const chunkId = reservation.chunkId;
    const organizationId = reservation.organizationId;
    const attemptCreatedAt = reservation.attemptCreatedAt;

    // Helper: mark this attempt failed with `code`. The mutation's identity
    // check refuses if the row was already overwritten by a fresher attempt,
    // so a slow failure from a stale attempt can't trample a new pending row.
    const markFailedAndReturn = async (code: TtsErrorCode) => {
      await ctx.runMutation(internal.tts.mutations.markChunkFailed, {
        chunkId,
        attemptCreatedAt,
        error: code,
      });
      return { status: 'failed' as const, errorCode: code };
    };

    let orgSlug: string;
    try {
      orgSlug = await resolveOrgSlug(ctx, organizationId);
    } catch (err) {
      const { code } = errorCodeFromCaught(err);
      return markFailedAndReturn(code);
    }

    let modelData;
    try {
      modelData = await resolveTtsModel(ctx, {
        orgSlug,
        locale: args.locale,
      });
    } catch (err) {
      const { code } = errorCodeFromCaught(err);
      return markFailedAndReturn(code);
    }

    // Defense-in-depth: re-check host policy at synthesis time so a provider
    // file edited to point at an internal host (e.g. metadata service) cannot
    // exfiltrate the bearer token, even when the file passed validation at
    // load time.
    try {
      checkProviderHostPolicy(modelData.baseUrl);
    } catch (err) {
      const { code } = errorCodeFromCaught(err);
      return markFailedAndReturn(code);
    }

    const url = `${modelData.baseUrl.replace(/\/+$/, '')}/audio/speech`;
    const mime =
      AUDIO_MIME_BY_FORMAT[modelData.audioFormat] ?? 'application/octet-stream';
    let storageId: Id<'_storage'>;
    try {
      // `safeFetchBinary` enforces the size cap during the streaming read,
      // so a chunked-transfer response can't buffer past MAX_AUDIO_BYTES
      // before the size check fires. It also re-validates the host on every
      // redirect hop so a 302 to the cloud metadata service can't smuggle
      // the bearer token.
      const response = await safeFetchBinary(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${modelData.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: modelData.modelId,
          input: text,
          voice: modelData.voice,
          response_format: modelData.audioFormat,
        }),
        timeoutMs: FETCH_TIMEOUT_MS,
        maxResponseBytes: MAX_AUDIO_BYTES,
        defaultContentType: mime,
      });
      if (response.status < 200 || response.status >= 300) {
        // Don't log the provider body — providers commonly echo input PII or
        // sensitive config in 4xx bodies. Surface status + origin only.
        const origin = (() => {
          try {
            return new URL(response.finalUrl).origin;
          } catch {
            return 'unknown';
          }
        })();
        console.warn('[tts] provider error', {
          status: response.status,
          origin,
        });
        throw new Error(`TTS API ${response.status}: provider call failed`);
      }
      const typedBlob =
        response.body.type && response.body.type !== ''
          ? response.body
          : new Blob([response.body], { type: mime });
      storageId = await ctx.storage.store(typedBlob);
    } catch (err) {
      const { code } = errorCodeFromCaught(err);
      return markFailedAndReturn(code);
    }

    // Compensating storage delete on post-store failure. Without this, any
    // throw from `markChunkReadyAndRecordUsage` (cascade-deleted row,
    // identity mismatch from a stale attempt, validator rejection, etc.)
    // would orphan the just-uploaded blob until the 7-day cron eventually
    // sweeps it. The mutation itself handles the identity-mismatch case
    // inline; this catch covers everything else.
    const costEstimateCents = estimateTtsCostCents(
      text.length,
      modelData.centsPerMillionCharacters,
    );
    try {
      const result = await ctx.runMutation(
        internal.tts.mutations.markChunkReadyAndRecordUsage,
        {
          chunkId,
          attemptCreatedAt,
          storageId,
          voice: modelData.voice,
          providerName: modelData.providerName,
          modelId: modelData.modelId,
          format: modelData.audioFormat,
          characterCount: text.length,
          costEstimateCents,
        },
      );
      if (result.stale) {
        // The mutation already deleted the blob inline. Surface as in-flight
        // so the client doesn't render an error — the fresher attempt owns
        // the row now.
        return { status: 'in-flight' as const };
      }
    } catch (err) {
      try {
        await ctx.storage.delete(storageId);
      } catch (deleteErr) {
        console.warn(
          '[tts] failed to delete orphan blob on mark-ready throw',
          deleteErr,
        );
      }
      console.warn('[tts] markChunkReadyAndRecordUsage threw', err);
      const { code } = errorCodeFromCaught(err);
      return markFailedAndReturn(code);
    }

    return { status: 'ready' as const };
  },
});

/**
 * Capability check the client uses to gate the TTS toggle and the
 * personalization-page voice section. Returns the configured TTS model
 * summary or `{ available: false }` when no provider has a `'text-to-speech'`
 * model for this org.
 *
 * Auth: requires the caller to be a current member of `organizationId`. The
 * provider/model identifiers in the success response are operationally
 * sensitive (they reveal which third-party vendor an org has wired up), so
 * a bare `requireAuthenticatedUser` check is insufficient — without the
 * membership gate, any logged-in user could probe arbitrary org IDs.
 *
 * NB: this is an `action` purely because `resolveTtsModel` runs in a Node
 * action. Phase 5 (deferred) converts it to a query once the resolver
 * dependency is unwound.
 */
export const getCapability = action({
  args: { organizationId: v.string() },
  returns: v.object({
    available: v.boolean(),
    providerName: v.optional(v.string()),
    modelId: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    // Cross-org probe gate: throws if the caller is not a member of the
    // requested org. The error propagates to the client — the toggle's
    // capability-check UI treats it as "unavailable" without distinguishing
    // "not configured" from "not allowed", so probing reveals nothing.
    try {
      await ctx.runQuery(
        internal.governance.internal_mutations
          .requireOrganizationMemberInternal,
        {
          organizationId: args.organizationId,
          userId: user.userId,
          email: user.email,
          name: user.name,
        },
      );
    } catch (err) {
      // Record the deny as a security signal so operators can correlate
      // repeated probes against a specific actor. Best-effort.
      await ctx.runMutation(internal.tts.mutations.logCapabilityProbeDenied, {
        organizationId: args.organizationId,
        actorId: user.userId,
        actorEmail: user.email,
      });
      throw err;
    }
    let orgSlug: string;
    try {
      orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    } catch (err) {
      console.warn(
        '[tts.getCapability] resolveOrgSlug failed',
        sanitizeError(err),
      );
      return { available: false };
    }
    try {
      const model = await resolveTtsModel(ctx, {
        orgSlug,
        locale: 'en',
      });
      return {
        available: true,
        providerName: model.providerName,
        modelId: model.modelId,
      };
    } catch (err) {
      console.warn(
        '[tts.getCapability] resolveTtsModel failed',
        sanitizeError(err),
      );
      return { available: false };
    }
  },
});
