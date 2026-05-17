import { v } from 'convex/values';

import {
  audioFormatLiterals,
  type AudioFormat,
} from '../../lib/shared/schemas/providers';
import type { Id } from '../_generated/dataModel';
import { internalQuery, query } from '../_generated/server';
import { getOrganizationMember } from '../lib/rls';
import { canAccessThread } from '../lib/rls/auth/can_access_thread';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { toId } from '../lib/type_cast_helpers';
import { ttsErrorCodeLiterals, type TtsErrorCode } from './error_codes';

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
      // `format` and `error` validators mirror the writer's closed
      // unions in `schema.ts` (built from `audioFormatLiterals` and
      // `ttsErrorCodeLiterals`). Widening to `v.string()` would let any
      // future drift between the storage shape and the literal set slip
      // through this query without failing the read validator — the
      // schema docstring explicitly relies on this contract.
      format: v.optional(
        v.union(...audioFormatLiterals.map((f) => v.literal(f))),
      ),
      error: v.optional(
        v.union(...ttsErrorCodeLiterals.map((c) => v.literal(c))),
      ),
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
      format?: AudioFormat;
      error?: TtsErrorCode;
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
  // `email` is threaded through so the membership check can fall back to
  // email lookup when the JWT's `userId` no longer matches the stored
  // member row (account linking / migration / JWT issued before the user
  // record was updated). Without the fallback, mid-migration users get
  // 404s for audio while the sibling `getMessageChunks` subscription —
  // which goes through the same fallback — still works, producing a
  // surprising silent-bubble UX.
  args: {
    chunkId: v.string(),
    userId: v.string(),
    email: v.optional(v.string()),
  },
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
        email: args.email,
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
 * `userPreferences.voiceOutput` (org-scoped if the thread has an org, else
 * any pref row the user owns) → `false`.
 */
export const getVoiceModeEffective = query({
  args: { threadId: v.string() },
  returns: v.object({
    enabled: v.boolean(),
    // `userDefault` exposes the raw master switch (`userPreferences.voiceOutput`)
    // so the chat-header dropdown can hide the per-thread override entirely
    // when voice output is OFF globally. Computing this from `enabled` alone
    // can't distinguish "master OFF" from "master ON, thread override OFF".
    userDefault: v.boolean(),
    source: v.union(
      v.literal('thread'),
      v.literal('preferences'),
      v.literal('default'),
    ),
  }),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const meta = await canAccessThread(ctx, args.threadId, user);
    if (!meta) {
      return { enabled: false, userDefault: false, source: 'default' as const };
    }
    // Org-scoped pref lookup when the thread carries an organizationId
    // (the common case). For legacy threads where `organizationId` is
    // absent we fall through to a prefix-only lookup so a user who set
    // voice ON globally still gets voice on those threads instead of
    // silently defaulting OFF.
    const organizationId = meta.organizationId;
    let prefs;
    if (organizationId) {
      prefs = await ctx.db
        .query('userPreferences')
        .withIndex('by_userId_organizationId', (q) =>
          q.eq('userId', user.userId).eq('organizationId', organizationId),
        )
        .first();
    } else {
      // Prefix-only on the same index — picks the first userPreferences row
      // the user owns in any org. If they have voice OFF in some orgs and ON
      // in others the result depends on Convex's index order, which is fine
      // for the legacy fallback: it just needs to not silently mute users
      // who enabled voice somewhere.
      prefs = await ctx.db
        .query('userPreferences')
        .withIndex('by_userId_organizationId', (q) =>
          q.eq('userId', user.userId),
        )
        .first();
    }
    const userDefault = prefs?.voiceOutput === true;
    // Hard veto: when the master switch is OFF, ignore any stale
    // `voiceOutputOverride` so a previously-set per-thread "on" can't keep
    // auto-playing voice with no visible control to mute it. The override
    // row is left alone — the resolver simply doesn't read it in this branch.
    if (!userDefault) {
      return {
        enabled: false,
        userDefault: false,
        source: prefs ? ('preferences' as const) : ('default' as const),
      };
    }
    if (typeof meta.voiceOutputOverride === 'boolean') {
      return {
        enabled: meta.voiceOutputOverride,
        userDefault: true,
        source: 'thread' as const,
      };
    }
    return {
      enabled: true,
      userDefault: true,
      source: 'preferences' as const,
    };
  },
});
