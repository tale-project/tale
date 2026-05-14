'use node';

import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { resolveTtsModel } from '../providers/resolve_model';

const MAX_CHUNK_CHARS = 2000;
const FETCH_TIMEOUT_MS = 60_000;

function sanitizeTtsError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, 'sk-[REDACTED]')
    .replace(/Authorization:\s*\S+/gi, 'Authorization: [REDACTED]')
    .slice(0, 500);
}

const AUDIO_MIME_BY_FORMAT: Record<string, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
};

/**
 * Synthesize one sentence/paragraph chunk of an assistant message. Client
 * calls this in order as it segments the streaming text; the action is
 * idempotent on `(messageId, index)` so re-tries and multi-tab races are
 * safe. When no `'text-to-speech'` provider is configured, the chunk row
 * is written with `status: 'failed', error: 'NO_PROVIDER'` and the client
 * uses its `speechSynthesis` fallback path for that index.
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

    let orgSlug: string;
    try {
      orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    } catch (err) {
      const message = sanitizeTtsError(err);
      await ctx.runMutation(internal.tts.mutations.markChunkFailed, {
        chunkId,
        error: `ORG_LOOKUP_FAILED: ${message}`,
      });
      return { status: 'failed' as const };
    }

    let modelData;
    try {
      modelData = await resolveTtsModel(ctx, {
        orgSlug,
        locale: args.locale,
      });
    } catch (err) {
      const message =
        err instanceof Error &&
        /UNKNOWN_(PROVIDER|MODEL|VOICE)/.test(err.message)
          ? err.message.split(':')[0] || 'NO_PROVIDER'
          : sanitizeTtsError(err);
      await ctx.runMutation(internal.tts.mutations.markChunkFailed, {
        chunkId,
        error: message,
      });
      return { status: 'failed' as const };
    }

    const url = `${modelData.baseUrl.replace(/\/+$/, '')}/audio/speech`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let storageId: Id<'_storage'>;
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
        const errBody = await response.text().catch(() => '');
        throw new Error(`TTS API ${response.status}: ${errBody.slice(0, 400)}`);
      }
      const arrayBuf = await response.arrayBuffer();
      const mime =
        AUDIO_MIME_BY_FORMAT[modelData.audioFormat] ??
        'application/octet-stream';
      const blob = new Blob([arrayBuf], { type: mime });
      storageId = await ctx.storage.store(blob);
    } catch (err) {
      const message = sanitizeTtsError(err);
      await ctx.runMutation(internal.tts.mutations.markChunkFailed, {
        chunkId,
        error: message,
      });
      return { status: 'failed' as const };
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
    return { status: 'ready' as const };
  },
});

/**
 * Capability check the client uses to decide between provider TTS and the
 * `speechSynthesis` browser fallback up-front. Returns the configured TTS
 * model summary or `{ available: false }` when no provider has a
 * `'text-to-speech'` model.
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
    } catch {
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
    } catch {
      return { available: false };
    }
  },
});
