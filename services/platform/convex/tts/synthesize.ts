'use node';

import { ConvexError, v } from 'convex/values';

import {
  MAX_TTS_CHUNK_CHARS,
  MIN_TTS_AUDIO_BYTES,
} from '../../lib/shared/constants/tts';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { estimateTtsCostCents } from '../governance/cost_estimation';
import { SafeFetchError, safeFetchBinary } from '../lib/http/safe_fetch';
import { rateLimiter } from '../lib/rate_limiter';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { checkProviderHostPolicy } from '../providers/file_actions';
import { resolveTtsModel } from '../providers/resolve_model';
import { errorCodeFromCaught, type TtsErrorCode } from './error_codes';

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

// Error-classification types and helper live in `./error_codes.ts` so
// they can be unit-tested without spinning up a 'use node' action runtime.
// The `TtsErrorCode` and `errorCodeFromCaught` imports above are the
// canonical names; this file no longer redeclares them.

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
    const user = await requireAuthenticatedUser(ctx);
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

    // Cross-org probe gate: refuse non-members before any provider config
    // is read. Without this, moving `resolveTtsModel` ahead of `reserveChunk`
    // (so the prospective-cost check can use the real per-model rate)
    // would let a logged-in user learn the TTS provider/model wired up to
    // an org they don't belong to. reserveChunk's `assertThreadAccess`
    // still runs later as the authoritative thread-membership check.
    await ctx.runQuery(
      internal.governance.internal_mutations.requireOrganizationMemberInternal,
      {
        organizationId: args.organizationId,
        userId: user.userId,
        email: user.email,
        name: user.name,
      },
    );

    // Resolve model up front so `reserveChunk`'s prospective-cost budget
    // check can use the real per-model `centsPerMillionCharacters` rate.
    // Without this, parallel chunks of one message can each pass a static
    // 1500 ¢/M-char gate and collectively overshoot the org's hard cap
    // when the active provider charges more (e.g. premium ElevenLabs
    // tier). A pre-reservation resolver failure (no provider, unknown
    // voice, etc.) returns a synthetic `failed` result with the
    // classified code — there's no chunk row to mark yet.
    let orgSlug: string;
    let modelData;
    try {
      orgSlug = await resolveOrgSlug(ctx, args.organizationId);
      modelData = await resolveTtsModel(ctx, {
        orgSlug,
        locale: args.locale,
      });
    } catch (err) {
      const { code } = errorCodeFromCaught(err);
      return { status: 'failed' as const, errorCode: code };
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
        prospectiveCostCentsPerMChars: modelData.centsPerMillionCharacters,
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
          ...(modelData.instructions
            ? { instructions: modelData.instructions }
            : {}),
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
          } catch (err) {
            // Defensive: `safeFetchBinary` only ever returns a parseable
            // `finalUrl`, but a future provider that proxies through an
            // odd redirect could in theory surface a malformed value
            // here. Log the parse failure (so we notice if it ever
            // happens) and continue with the safe 'unknown' placeholder.
            console.debug(
              '[tts] response.finalUrl unparseable; falling back to "unknown"',
              err,
            );
            return 'unknown';
          }
        })();
        console.warn('[tts] provider error', {
          status: response.status,
          origin,
        });
        throw new Error(`TTS API ${response.status}: provider call failed`);
      }
      // Empty / near-empty 200 responses (provider misconfiguration,
      // upstream JSON-error-as-200, partial outage) would otherwise be
      // stored as a zero-byte blob and fully billed via the ledger,
      // yielding no audible audio. Refuse before the storage write so
      // the chunk is marked failed and never debited.
      if (response.body.size < MIN_TTS_AUDIO_BYTES) {
        console.warn('[tts] provider returned implausibly small body', {
          bytes: response.body.size,
          status: response.status,
        });
        throw new SafeFetchError(
          'response_too_small',
          `Provider returned ${response.body.size} bytes (< ${MIN_TTS_AUDIO_BYTES}); refusing to bill for empty audio`,
          response.status,
        );
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
      console.warn(
        '[tts] markChunkReadyAndRecordUsage threw',
        sanitizeError(err),
      );
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
    // Per-user rate-limit gate runs BEFORE the membership check so a
    // logged-in user can't probe arbitrary `organizationId`s to fill the
    // target org's audit log via `logCapabilityProbeDenied`. The
    // personalization UI calls this once per mount; 12/min/user is
    // generous for human use and tight for scripted probes.
    const probeLimit = await rateLimiter.limit(
      ctx,
      'tts:capability-probe:user',
      {
        key: user.userId,
        throws: false,
      },
    );
    if (!probeLimit.ok) {
      throw new ConvexError({
        code: 'RATE_LIMITED',
        message: 'Capability probe rate limit exceeded.',
        retryAfter: probeLimit.retryAfter,
      });
    }
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
      // `UNKNOWN_VOICE` means the TTS model resolved but neither
      // `voicesByLocale['en']` nor `defaultVoice` matched. An org that
      // wired up `voicesByLocale: { de: ... }` only is still capable —
      // synthesis will pick a real voice from the caller's actual locale
      // at synth time. Capability probe should report `available: true`
      // so the settings UI doesn't render the "provider unavailable"
      // banner. We can't fill in providerName/modelId without re-running
      // the resolver, which is acceptable — those fields are
      // informational on the capability response.
      if (err instanceof Error && err.message.startsWith('UNKNOWN_VOICE:')) {
        return { available: true };
      }
      console.warn(
        '[tts.getCapability] resolveTtsModel failed',
        sanitizeError(err),
      );
      return { available: false };
    }
  },
});
