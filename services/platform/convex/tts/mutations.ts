import { ConvexError, v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';

/**
 * Patch the current user's global voice-output default. Affects all new
 * conversations the user starts; existing threads keep whatever override
 * they had. The mutation creates the `userPreferences` row on demand so
 * users who have never touched personalization can still toggle voice.
 */
export const setUserVoiceOutput = mutation({
  args: { organizationId: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const existing = await ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q.eq('userId', user.userId).eq('organizationId', args.organizationId),
      )
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        voiceOutput: args.enabled,
        updatedAt: Date.now(),
      });
      return null;
    }
    await ctx.db.insert('userPreferences', {
      userId: user.userId,
      organizationId: args.organizationId,
      customInstructions: '',
      voiceOutput: args.enabled,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Set or clear the per-thread voice-output override. Passing `null` clears
 * the override so the thread inherits the user's global default again.
 */
export const setThreadVoiceOutputOverride = mutation({
  args: {
    threadId: v.string(),
    override: v.union(v.boolean(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const meta = await assertThreadAccess(ctx, args.threadId, user);
    await ctx.db.patch(meta._id, {
      voiceOutputOverride: args.override === null ? undefined : args.override,
    });
    return null;
  },
});

/**
 * Internal: reserve a chunk row in `'pending'` status. Returns:
 *  - `{ status: 'ready', storageId }` when an existing ready chunk is reused
 *  - `{ status: 'pending', alreadyInFlight: true }` when another writer holds the slot
 *  - `{ status: 'pending', alreadyInFlight: false, chunkId }` for the fresh reservation
 */
export const reserveChunk = internalMutation({
  args: {
    messageId: v.string(),
    threadId: v.string(),
    organizationId: v.string(),
    index: v.number(),
    text: v.string(),
    locale: v.string(),
  },
  returns: v.union(
    v.object({
      kind: v.literal('ready'),
      storageId: v.id('_storage'),
      voice: v.optional(v.string()),
      format: v.optional(v.string()),
    }),
    v.object({ kind: v.literal('pending-in-flight') }),
    v.object({
      kind: v.literal('reserved'),
      chunkId: v.id('ttsAudioChunks'),
    }),
  ),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_message', (q) =>
        q.eq('messageId', args.messageId).eq('index', args.index),
      )
      .first();
    if (existing) {
      if (existing.status === 'ready' && existing.storageId) {
        return {
          kind: 'ready' as const,
          storageId: existing.storageId,
          voice: existing.voice,
          format: existing.format,
        };
      }
      if (existing.status === 'pending') {
        return { kind: 'pending-in-flight' as const };
      }
      // Previously failed — overwrite to retry.
      await ctx.db.patch(existing._id, {
        status: 'pending',
        error: undefined,
        text: args.text,
        locale: args.locale,
        createdAt: Date.now(),
      });
      return { kind: 'reserved' as const, chunkId: existing._id };
    }
    const chunkId = await ctx.db.insert('ttsAudioChunks', {
      messageId: args.messageId,
      threadId: args.threadId,
      organizationId: args.organizationId,
      index: args.index,
      text: args.text,
      status: 'pending',
      locale: args.locale,
      createdAt: Date.now(),
    });
    return { kind: 'reserved' as const, chunkId };
  },
});

export const markChunkReady = internalMutation({
  args: {
    chunkId: v.id('ttsAudioChunks'),
    storageId: v.id('_storage'),
    voice: v.string(),
    providerName: v.string(),
    modelId: v.string(),
    format: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.chunkId, {
      status: 'ready',
      storageId: args.storageId,
      voice: args.voice,
      providerName: args.providerName,
      modelId: args.modelId,
      format: args.format,
      error: undefined,
    });
    return null;
  },
});

export const markChunkFailed = internalMutation({
  args: {
    chunkId: v.id('ttsAudioChunks'),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.chunkId, {
      status: 'failed',
      error: args.error,
    });
    return null;
  },
});

/**
 * Opportunistic GC for old TTS chunks. Deletes up to `limit` rows older than
 * `olderThanMs` for the given thread. Called from a read path with a rate
 * limiter — never from a cron — so storage stays bounded without a scheduled
 * job that wakes idle deployments.
 */
export const cleanupOldChunks = internalMutation({
  args: {
    threadId: v.string(),
    olderThanMs: v.number(),
    limit: v.number(),
  },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    if (args.limit <= 0) {
      throw new ConvexError({
        code: 'BAD_REQUEST',
        message: 'limit must be positive',
      });
    }
    const cutoff = Date.now() - args.olderThanMs;
    const candidates = await ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_thread_age', (q) =>
        q.eq('threadId', args.threadId).lt('createdAt', cutoff),
      )
      .take(args.limit);
    let deleted = 0;
    for (const row of candidates) {
      if (row.storageId) {
        try {
          await ctx.storage.delete(row.storageId);
        } catch (err) {
          console.warn('[tts.cleanup] failed to delete storage blob', err);
        }
      }
      await ctx.db.delete(row._id);
      deleted++;
    }
    return { deleted };
  },
});
