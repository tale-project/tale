import { v } from 'convex/values';

import { query } from '../_generated/server';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';

/**
 * Subscribed by the client message bubble: returns the ordered list of
 * audio chunks for the given assistant message. Used by the player hook
 * to chain `<audio>` playback and to detect failed chunks (which flip
 * the UI to the speechSynthesis fallback path).
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
      index: v.number(),
      status: v.union(
        v.literal('pending'),
        v.literal('ready'),
        v.literal('failed'),
      ),
      url: v.union(v.string(), v.null()),
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
      _id: string;
      index: number;
      status: 'pending' | 'ready' | 'failed';
      storageId: string | undefined;
      voice?: string;
      format?: string;
      error?: string;
      text: string;
      threadId: string;
      organizationId: string;
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
        _id: row._id,
        index: row.index,
        status: row.status,
        storageId: row.storageId,
        voice: row.voice,
        format: row.format,
        error: row.error,
        text: row.text,
        threadId: row.threadId,
        organizationId: row.organizationId,
        createdAt: row.createdAt,
      });
    }
    rows.sort((a, b) => a.index - b.index);
    // Resolve URLs in parallel — sequential awaits previously turned every
    // subscription tick into N storage round-trips.
    const urls = await Promise.all(
      rows.map((row) =>
        row.status === 'ready' && row.storageId
          ? ctx.storage.getUrl(row.storageId)
          : Promise.resolve(null),
      ),
    );
    return rows.map((row, i) => ({
      index: row.index,
      status: row.status,
      url: urls[i],
      voice: row.voice,
      format: row.format,
      error: row.error,
      text: row.text,
      createdAt: row.createdAt,
    }));
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
