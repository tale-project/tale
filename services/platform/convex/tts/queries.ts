import { v } from 'convex/values';

import {
  audioFormatLiterals,
  type AudioFormat,
} from '../../lib/shared/schemas/providers';
import type { Id } from '../_generated/dataModel';
import { type QueryCtx, internalQuery, query } from '../_generated/server';
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
 * Org-level voice-output kill switch. Read from the dedicated
 * `policyType: 'voice_output'` row in `governancePolicies` (config shape
 * `{ enabled: boolean }`). Missing row → default ON (existing deployments
 * keep current behaviour); explicit `enabled: false` is the org-wide veto
 * that overrides every user pref and thread override.
 *
 * Inlined (not exposed via `internalQuery`) because this is the sole
 * consumer; `tts/queries.ts` is the single source of truth for the cascade.
 */
async function isVoiceOutputOrgEnabled(
  ctx: QueryCtx,
  organizationId: string,
): Promise<boolean> {
  const policy = await ctx.db
    .query('governancePolicies')
    .withIndex('by_org_policyType', (q) =>
      q.eq('organizationId', organizationId).eq('policyType', 'voice_output'),
    )
    .first();
  if (!policy) return true;
  if (policy.enabled === false) return false;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `policy.config` is `Record<string, unknown>` per schema; we narrow to a specific shape and probe `enabled` defensively.
  const config = policy.config as { enabled?: unknown } | undefined;
  // Be strict about the inner gate: only `enabled === false` disables.
  // Missing/malformed config is treated as "ON" so a half-written row
  // doesn't silently mute the whole org.
  return config?.enabled !== false;
}

/**
 * Effective voice-mode setting for the chat UI. Combines the per-thread
 * override with the user's global default and the org-level governance
 * policy; client uses this to drive both the auto-chunk hook and the
 * toggle UI state.
 *
 * Precedence (top wins):
 *  1. org `policyType: 'voice_output'` veto (`config.enabled === false`)
 *     — admin kill switch; overrides every user/thread setting.
 *  2. `threadMetadata.voiceOutputOverride` — per-conversation override.
 *     Asymmetric: only respected when the user master switch is ON; a
 *     master-OFF user can't be silently un-muted by a stale override.
 *  3. `userPreferences.voiceOutput` — per-user master switch.
 *  4. Default `false`.
 *
 * Legacy threads with no `organizationId` cannot resolve an org-level
 * policy or an org-scoped user pref, so they default to OFF. This is a
 * deliberate tightening: the old non-deterministic prefix-only fallback
 * (round-2 HIGH #9) is gone — legacy threads are a vanishing tail and
 * silently honoring "any" pref row across orgs leaked voice settings
 * across org boundaries.
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
      v.literal('org_policy'),
    ),
  }),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const meta = await canAccessThread(ctx, args.threadId, user);
    if (!meta) {
      return { enabled: false, userDefault: false, source: 'default' as const };
    }
    const organizationId = meta.organizationId;
    if (!organizationId) {
      // Legacy thread (pre-org-attribution). No org context means we can't
      // evaluate the org-level policy or an org-scoped user pref. Default
      // OFF — see docstring above; this is the tightening for round-2 #9.
      return { enabled: false, userDefault: false, source: 'default' as const };
    }

    // Org-level kill switch runs first. Admins can disable voice for the
    // entire tenant via `policyType: 'voice_output'`; this veto fires
    // before any user pref or thread override is read.
    const orgEnabled = await isVoiceOutputOrgEnabled(ctx, organizationId);
    if (!orgEnabled) {
      return {
        enabled: false,
        userDefault: false,
        source: 'org_policy' as const,
      };
    }

    const prefs = await ctx.db
      .query('userPreferences')
      .withIndex('by_userId_organizationId', (q) =>
        q.eq('userId', user.userId).eq('organizationId', organizationId),
      )
      .first();
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
