'use node';

import { ConvexError, v } from 'convex/values';

import { TTS_SLUG } from '../../lib/shared/constants/usage';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { estimateTtsCostCents } from '../governance/cost_estimation';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { NoProviderAvailableError } from '../providers/errors';
import { checkProviderHostPolicy } from '../providers/file_actions';
import { resolveTtsModel } from '../providers/resolve_model';

const MAX_CHUNK_CHARS = 2000;
const FETCH_TIMEOUT_MS = 60_000;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB hard cap on provider response

function sanitizeTtsError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-[REDACTED]')
    .replace(/Authorization:\s*\S+/gi, 'Authorization: [REDACTED]')
    .slice(0, 200);
}

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
  | 'BUDGET_EXCEEDED'
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
  const detail = sanitizeTtsError(err);
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
  }
  // Same-action throws from resolveTtsModel use `new Error('UNKNOWN_VOICE: ...')`.
  if (err instanceof Error && err.message.startsWith('UNKNOWN_VOICE:')) {
    return { code: 'UNKNOWN_VOICE', retryable: false, detail };
  }
  // Host-policy violation surfaces as a plain Error with a known prefix.
  if (err instanceof Error && /host policy/i.test(err.message)) {
    return { code: 'HOST_POLICY', retryable: false, detail };
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
    if (text.length > MAX_CHUNK_CHARS) {
      throw new ConvexError({
        code: 'TTS_TEXT_TOO_LONG',
        message: `Chunk text exceeds ${MAX_CHUNK_CHARS} characters; client must re-segment.`,
      });
    }

    // `reserveChunk` throws forbidden / rate-limit / budget / chunk-limit
    // errors. These are not chunk-row-recoverable (we don't own a chunkId
    // yet), so we don't catch them — the action surfaces them to the client
    // as a hard failure distinct from a chunk-level `failed` row, which
    // lets the UI render the right recovery affordance.
    const reservation = await ctx.runMutation(
      internal.tts.mutations.reserveChunk,
      {
        messageId: args.messageId,
        threadId: args.threadId,
        organizationId: args.organizationId,
        index: args.index,
        text,
        locale: args.locale,
      },
    );

    if (reservation.kind === 'ready') {
      return { status: 'ready' as const };
    }
    if (reservation.kind === 'pending-in-flight') {
      return { status: 'in-flight' as const };
    }
    const chunkId = reservation.chunkId;
    const organizationId = reservation.organizationId;
    const userId = reservation.userId;

    let orgSlug: string;
    try {
      orgSlug = await resolveOrgSlug(ctx, organizationId);
    } catch (err) {
      const { code, detail } = errorCodeFromCaught(err);
      await ctx.runMutation(internal.tts.mutations.markChunkFailed, {
        chunkId,
        error: `${code}: ${detail}`,
      });
      return { status: 'failed' as const, errorCode: code };
    }

    let modelData;
    try {
      modelData = await resolveTtsModel(ctx, {
        orgSlug,
        locale: args.locale,
      });
    } catch (err) {
      const { code } = errorCodeFromCaught(err);
      await ctx.runMutation(internal.tts.mutations.markChunkFailed, {
        chunkId,
        error: code,
      });
      return { status: 'failed' as const, errorCode: code };
    }

    // Defense-in-depth: re-check host policy at synthesis time so a provider
    // file edited to point at an internal host (e.g. metadata service) cannot
    // exfiltrate the bearer token, even when the file passed validation at
    // load time.
    try {
      checkProviderHostPolicy(modelData.baseUrl);
    } catch (err) {
      const { code, detail } = errorCodeFromCaught(err);
      await ctx.runMutation(internal.tts.mutations.markChunkFailed, {
        chunkId,
        error: `${code}: ${detail}`,
      });
      return { status: 'failed' as const, errorCode: code };
    }

    const url = `${modelData.baseUrl.replace(/\/+$/, '')}/audio/speech`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let storageId: Id<'_storage'>;
    let mime: string;
    try {
      const response = await fetch(url, {
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
        signal: controller.signal,
      });
      if (!response.ok) {
        // Don't store provider error bodies verbatim — they can echo input
        // PII or sensitive config. Surface only the status code; admins
        // see the body in server logs.
        const errBody = await response.text().catch((bodyErr) => {
          console.warn('[tts] failed to read provider error body', bodyErr);
          return '';
        });
        console.warn(
          `[tts] provider returned ${response.status}: ${errBody.slice(0, 400)}`,
        );
        throw new Error(`TTS API ${response.status}: provider call failed`);
      }
      // Reject obviously oversized responses before buffering — protects
      // the Node action from OOM if a misbehaving provider streams gigabytes.
      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > MAX_AUDIO_BYTES) {
        throw new Error(
          `TTS API 413: response too large (${contentLength} bytes)`,
        );
      }
      const blob = await response.blob();
      if (blob.size > MAX_AUDIO_BYTES) {
        throw new Error(`TTS API 413: response too large (${blob.size} bytes)`);
      }
      mime =
        AUDIO_MIME_BY_FORMAT[modelData.audioFormat] ??
        'application/octet-stream';
      const typedBlob =
        blob.type && blob.type !== '' ? blob : new Blob([blob], { type: mime });
      storageId = await ctx.storage.store(typedBlob);
    } catch (err) {
      const { code, detail } = errorCodeFromCaught(err);
      await ctx.runMutation(internal.tts.mutations.markChunkFailed, {
        chunkId,
        error: `${code}: ${detail}`,
      });
      return { status: 'failed' as const, errorCode: code };
    } finally {
      clearTimeout(timeout);
    }

    await ctx.runMutation(internal.tts.mutations.markChunkReady, {
      chunkId,
      storageId,
      voice: modelData.voice,
      providerName: modelData.providerName,
      modelId: modelData.modelId,
      format: modelData.audioFormat,
    });

    // Record billable usage. Failure here is non-fatal for the user-facing
    // playback path — the chunk is already `ready` and audible — so log and
    // continue rather than rolling back.
    try {
      const costEstimateCents = estimateTtsCostCents(
        text.length,
        modelData.centsPerMillionCharacters,
      );
      await ctx.runMutation(
        internal.governance.internal_mutations.recordTtsUsage,
        {
          organizationId,
          userId,
          agentSlug: TTS_SLUG,
          model: modelData.modelId,
          provider: modelData.providerName,
          characterCount: text.length,
          costEstimateCents,
          timestamp: Date.now(),
        },
      );
    } catch (err) {
      console.warn('[tts] failed to record usage ledger entry', err);
    }

    return { status: 'ready' as const };
  },
});

/**
 * Capability check the client uses to decide between provider TTS and the
 * `speechSynthesis` browser fallback up-front. Returns the configured TTS
 * model summary or `{ available: false }` when no provider has a
 * `'text-to-speech'` model.
 *
 * NB: this is an `action` purely because `resolveTtsModel` calls into a
 * Node-only `runAction`. Phase 5 converts it to a query once the resolver
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
    await requireAuthenticatedUser(ctx);
    let orgSlug: string;
    try {
      orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    } catch (err) {
      console.warn('[tts.getCapability] resolveOrgSlug failed', err);
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
      console.warn('[tts.getCapability] resolveTtsModel failed', err);
      return { available: false };
    }
  },
});
