import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import { internalQuery, query } from '../_generated/server';
import { getOrganizationMember } from '../lib/rls';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { toId } from '../lib/type_cast_helpers';

/**
 * Subscribed by the client message bubble: returns the ordered list of
 * audio chunks for the given assistant message. The player hook chains
 * `<audio>` playback and skips failed chunks (their `error` code drives
 * the indicator's recovery UX). Playback is provider-only — there is no
 * `speechSynthesis` browser fallback path.
 *
 * Access control: the caller must be able to read the parent thread AND
 * each chunk row must independently belong to that thread and the thread's
 * org. `messageId` is `v.string()` (the agent-component's message id), so
 * we cannot rely on the index alone to pin identity — a leaked messageId
 * from another org paired with any thread the caller does control would
 * otherwise return foreign audio URLs.
 *
 * Returns `[]` when the thread is inaccessible or no chunks exist — never
 * throws on access failure, to keep the subscription cheap.
 */
export const getMessageChunks = query({
  args: { messageId: v.string(), threadId: v.string() },
  returns: v.array(
    v.object({
      // `chunkId` is what the client uses to request audio bytes via the
      // authenticated `/api/tts-audio` route — previously the query
      // returned a pre-resolved `_storage` URL that was bearer-replayable
      // for the row's 7-day lifetime. Returning the id forces every fetch
      // through the membership-gated HTTP handler.
      chunkId: v.id('ttsAudioChunks'),
      index: v.number(),
      status: v.union(
        v.literal('pending'),
        v.literal('ready'),
        v.literal('failed'),
      ),
      voice: v.optional(v.string()),
      format: v.optional(v.string()),
      error: v.optional(v.string()),
      text: v.string(),
      // Used by the player to distinguish chunks created during the current
      // mount (auto-play candidates) from chunks loaded on thread revisit
      // (historical — must not auto-play).
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const meta = await canAccessThread(ctx, args.threadId, user);
    if (!meta) return [];
    const rows: Array<{
      chunkId: Id<'ttsAudioChunks'>;
      index: number;
      status: 'pending' | 'ready' | 'failed';
      voice?: string;
      format?: string;
      error?: string;
      text: string;
      createdAt: number;
    }> = [];
    // AGENTS.md mandates `for await` over `.collect()` so large result sets
    // don't pull into memory wholesale.
    for await (const row of ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_message', (q) => q.eq('messageId', args.messageId))) {
      // Cross-field identity check: defends against a leaked / guessed
      // messageId belonging to a different thread or org.
      if (row.threadId !== args.threadId) continue;
      if (meta.organizationId && row.organizationId !== meta.organizationId) {
        continue;
      }
      rows.push({
        chunkId: row._id,
        index: row.index,
        status: row.status,
        voice: row.voice,
        format: row.format,
        error: row.error,
        text: row.text,
        createdAt: row.createdAt,
      });
    }
    rows.sort((a, b) => a.index - b.index);
    return rows;
  },
});

/**
 * Internal: resolve a `ttsAudioChunks` row for the `/api/tts-audio` HTTP
 * handler. Returns `null` when the row is missing, not yet `'ready'`, or
 * when the caller is not a member of the row's org. Conflating "not
 * found" with "forbidden" keeps probing useless for outsiders.
 */
export const getChunkForServe = internalQuery({
  args: { chunkId: v.string(), userId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      storageId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const chunk = await ctx.db.get(toId<'ttsAudioChunks'>(args.chunkId));
    if (!chunk) return null;
    if (chunk.status !== 'ready' || !chunk.storageId) return null;

    // Membership gate — the caller must be a current member of the org
    // that owns this chunk. Use `getOrganizationMember` directly to avoid
    // depending on the action-context auth helper here. The catch logs
    // (per CLAUDE.md no-empty-catch) but conflates not-found / not-member
    // / DB-error into a single `null` so probing reveals nothing
    // beyond "chunk inaccessible".
    try {
      await getOrganizationMember(ctx, chunk.organizationId, {
        userId: args.userId,
      });
    } catch (err) {
      console.debug(
        '[tts.getChunkForServe] membership check failed',
        { userId: args.userId, organizationId: chunk.organizationId },
        err,
      );
      return null;
    }

    return { storageId: chunk.storageId };
  },
});

/**
 * Effective voice-mode setting for the chat UI. Combines the per-thread
 * override with the user's global default; client uses this to drive both
 * the auto-chunk hook and the toggle UI state.
 *
 * Precedence: `threadMetadata.voiceOutputOverride` →
 * `userPreferences.voiceOutput` → `false`.
 */
export const getVoiceModeEffective = query({
  args: { threadId: v.string() },
  returns: v.object({
    enabled: v.boolean(),
    source: v.union(
      v.literal('thread'),
      v.literal('preferences'),
      v.literal('default'),
    ),
  }),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const meta = await canAccessThread(ctx, args.threadId, user);
    if (!meta) return { enabled: false, source: 'default' as const };
    if (typeof meta.voiceOutputOverride === 'boolean') {
      return { enabled: meta.voiceOutputOverride, source: 'thread' as const };
    }
    const organizationId = meta.organizationId;
    if (!organizationId) {
      return { enabled: false, source: 'default' as const };
    }
    const prefs = await ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q.eq('userId', user.userId).eq('organizationId', organizationId),
      )
      .first();
    if (prefs && typeof prefs.voiceOutput === 'boolean') {
      return {
        enabled: prefs.voiceOutput,
        source: 'preferences' as const,
      };
    }
    return { enabled: false, source: 'default' as const };
  },
});
