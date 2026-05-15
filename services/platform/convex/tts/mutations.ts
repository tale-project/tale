import { ConvexError, v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation, mutation } from '../_generated/server';
import { checkBudget } from '../governance/budget_enforcement';
import { resolveBudgetContext } from '../governance/resolve_budget_context';
import { rateLimiter } from '../lib/rate_limiter';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';

// Lazy GC parameters. ~7-day retention matches the schema docstring;
// PASS_LIMIT bounds work per trigger so a backlog doesn't stall a sweep.
const CHUNK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_PASS_LIMIT = 64;

// Hard cap on chunks per assistant message. Bounds cost-of-abuse: a single
// `messageId` cannot exceed this many `(messageId, index)` rows even if the
// caller iterates `index`. 200 covers an extraordinarily long reply
// (~400KB of synthesised text at MAX_CHUNK_CHARS=2000) — anything beyond
// is treated as a scripted abuse pattern, not an honest stream.
export const MAX_CHUNKS_PER_MESSAGE = 200;

// Mirror of synthesize.ts FETCH_TIMEOUT_MS for the pending-watchdog horizon.
// Keeping it in mutations.ts avoids a circular import on the Node action.
const PENDING_STALE_MS = 60_000 * 3;

/**
 * Patch the current user's global voice-output default. Affects all new
 * conversations the user starts; existing threads keep whatever override
 * they had. The mutation creates the `userPreferences` row on demand so
 * users who have never touched personalization can still toggle voice.
 *
 * Auth: caller must be a current member of `organizationId` (per the
 * user-private + org-scoped contract in `assertSelfAndOrgMember`).
 */
export const setUserVoiceOutput = mutation({
  args: { organizationId: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    await assertSelfAndOrgMember(ctx, user, user.userId, args.organizationId);
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
    organizationId: v.optional(v.string()),
    override: v.union(v.boolean(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const meta = await assertThreadAccess(
      ctx,
      args.threadId,
      user,
      args.organizationId,
    );
    await ctx.db.patch(meta._id, {
      voiceOutputOverride: args.override === null ? undefined : args.override,
    });
    return null;
  },
});

/**
 * Internal: reserve a chunk row in `'pending'` status. Returns one of:
 *  - `{ kind: 'ready', storageId, voice, format }` — existing ready chunk reused
 *  - `{ kind: 'pending-in-flight' }` — another writer holds the slot
 *  - `{ kind: 'reserved', chunkId, organizationId, userId }` — fresh reservation
 *
 * This is the single gate for every TTS synthesis: it (a) authenticates the
 * caller, (b) verifies thread access and derives the canonical organizationId
 * from thread metadata (never trusting the client arg), (c) enforces per-user
 * and per-org rate limits, (d) consults org budget policy, (e) caps chunks per
 * message, and (f) cross-checks identity on collision with an existing row.
 *
 * The action calls this first; everything downstream (provider fetch, storage
 * write, ledger insert) only runs once this returns `'reserved'`.
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
      organizationId: v.string(),
      userId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    // Verifies thread membership + derives canonical organizationId.
    const meta = await assertThreadAccess(
      ctx,
      args.threadId,
      user,
      args.organizationId,
    );
    const organizationId = meta.organizationId ?? args.organizationId;

    if (
      !Number.isInteger(args.index) ||
      args.index < 0 ||
      args.index >= MAX_CHUNKS_PER_MESSAGE
    ) {
      throw new ConvexError({
        code: 'TTS_CHUNK_LIMIT',
        message: `TTS chunk index must be in [0, ${MAX_CHUNKS_PER_MESSAGE}).`,
      });
    }

    // Bounded-cost guard: per-user bucket pinpoints the abuser; per-org bucket
    // is the second line of defence when multiple users in one org coordinate.
    const userLimit = await rateLimiter.limit(ctx, 'tts:synthesize:user', {
      key: user.userId,
      throws: false,
    });
    if (!userLimit.ok) {
      throw new ConvexError({
        code: 'RATE_LIMITED',
        message: 'TTS rate limit exceeded for this user.',
        retryAfter: userLimit.retryAfter,
      });
    }
    const orgLimit = await rateLimiter.limit(ctx, 'tts:synthesize:org', {
      key: organizationId,
      throws: false,
    });
    if (!orgLimit.ok) {
      throw new ConvexError({
        code: 'RATE_LIMITED',
        message: 'TTS rate limit exceeded for this organization.',
        retryAfter: orgLimit.retryAfter,
      });
    }

    const { userTeamIds, userRole } = await resolveBudgetContext(
      ctx,
      organizationId,
      user.userId,
    );
    const budget = await checkBudget(
      ctx,
      organizationId,
      user.userId,
      userTeamIds,
      userRole,
    );
    if (!budget.allowed) {
      throw new ConvexError({
        code: 'BUDGET_EXCEEDED',
        message:
          budget.reason ??
          'TTS budget exceeded for this period. Contact your administrator.',
      });
    }

    const existing = await ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_message', (q) =>
        q.eq('messageId', args.messageId).eq('index', args.index),
      )
      .first();
    if (existing) {
      // Cross-field identity check: a foreign messageId paired with a thread
      // the caller *can* access must not be allowed to overwrite a chunk
      // owned by a different thread/org. (`messageId` is `v.string()`, not
      // an `_id`, so the index alone does not pin identity.)
      if (
        existing.threadId !== args.threadId ||
        existing.organizationId !== organizationId
      ) {
        throw new ConvexError({
          code: 'forbidden',
          message: 'TTS chunk identity mismatch.',
        });
      }
      if (existing.status === 'ready' && existing.storageId) {
        return {
          kind: 'ready' as const,
          storageId: existing.storageId,
          voice: existing.voice,
          format: existing.format,
        };
      }
      if (existing.status === 'pending') {
        const age = Date.now() - existing.createdAt;
        if (age < PENDING_STALE_MS) {
          return { kind: 'pending-in-flight' as const };
        }
        // Stale pending — the action that reserved this either crashed or
        // got dropped by a deploy; treat as failed and let the new caller
        // retry. Falls through to the overwrite branch below.
      }
      // Previously failed (or stale-pending) — overwrite to retry. Reset every
      // result-bearing field so a provider switch / model swap can't leave
      // stale metadata around for a query subscriber to read.
      await ctx.db.patch(existing._id, {
        status: 'pending' as const,
        error: undefined,
        text: args.text,
        locale: args.locale,
        createdAt: Date.now(),
        voice: undefined,
        providerName: undefined,
        modelId: undefined,
        format: undefined,
        storageId: undefined,
      });
      return {
        kind: 'reserved' as const,
        chunkId: existing._id,
        organizationId,
        userId: user.userId,
      };
    }
    const chunkId = await ctx.db.insert('ttsAudioChunks', {
      messageId: args.messageId,
      threadId: args.threadId,
      organizationId,
      index: args.index,
      text: args.text,
      status: 'pending',
      locale: args.locale,
      createdAt: Date.now(),
    });
    return {
      kind: 'reserved' as const,
      chunkId,
      organizationId,
      userId: user.userId,
    };
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
    // Opportunistic GC: schedule a cleanup pass for this thread. The
    // `cleanup:tts` rate limiter inside `maybeCleanupChunks` keeps actual
    // work to once per thread per hour regardless of how often this fires.
    const row = await ctx.db.get(args.chunkId);
    if (row) {
      await ctx.scheduler.runAfter(
        0,
        internal.tts.mutations.maybeCleanupChunks,
        {
          threadId: row.threadId,
          olderThanMs: CHUNK_RETENTION_MS,
          limit: CLEANUP_PASS_LIMIT,
        },
      );
    }
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
 * `olderThanMs` for the given thread. Called from `getMessageChunks` via the
 * `cleanup:tts` rate-limiter token (at most once per thread per hour) — never
 * from a cron — so storage stays bounded without a scheduled job that wakes
 * idle deployments.
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

/**
 * Opportunistic cleanup trigger from the read path. Rate-limited via the
 * `cleanup:tts` token (one pass per thread per hour) so subscription chatter
 * doesn't trigger a sweep on every tick. Returns silently when the limiter
 * gates the call.
 */
export const maybeCleanupChunks = internalMutation({
  args: {
    threadId: v.string(),
    olderThanMs: v.number(),
    limit: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const gate = await rateLimiter.limit(ctx, 'cleanup:tts', {
      key: args.threadId,
      throws: false,
    });
    if (!gate.ok) return null;
    if (args.limit <= 0) return null;
    const cutoff = Date.now() - args.olderThanMs;
    const candidates = await ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_thread_age', (q) =>
        q.eq('threadId', args.threadId).lt('createdAt', cutoff),
      )
      .take(args.limit);
    for (const row of candidates) {
      if (row.storageId) {
        try {
          await ctx.storage.delete(row.storageId);
        } catch (err) {
          console.warn('[tts.cleanup] failed to delete storage blob', err);
        }
      }
      await ctx.db.delete(row._id);
    }
    return null;
  },
});
