import { v } from 'convex/values';

import {
  audioFormatLiterals,
  type AudioFormat,
} from '../../lib/shared/schemas/providers';
import type { Doc, Id } from '../_generated/dataModel';
import { type QueryCtx, internalQuery, query } from '../_generated/server';
import { readConfigCacheRow } from '../lib/config_cache/read';
import { getOrganizationMember } from '../lib/rls';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { toId } from '../lib/type_cast_helpers';
import { AUDIO_MIME_BY_FORMAT } from './audio_mime';
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
    const meta = await ownedChatThread(ctx, args.threadId, user.userId);
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
 * Aggregate TTS voice usage for a single assistant message. Powers the
 * "Voice output" section of the message info dialog: returns the per-
 * `(provider, model, voice)` breakdown of ready chunks plus totals. Returns
 * `null` when the caller can't access the thread or no ready chunks carry
 * billing info (legacy rows pre-date the per-chunk `characterCount` /
 * `costEstimateCents` fields).
 *
 * Access control mirrors `getMessageChunks` exactly — same RLS contract,
 * same cross-field identity check against `threadId` and the row's org.
 */
export const getMessageVoiceUsage = query({
  args: { messageId: v.string(), threadId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      totalCharacters: v.number(),
      totalCostCents: v.number(),
      chunkCount: v.number(),
      breakdown: v.array(
        v.object({
          provider: v.string(),
          model: v.string(),
          voice: v.optional(v.string()),
          characters: v.number(),
          costCents: v.number(),
          chunkCount: v.number(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await requireAuthenticatedUser(ctx);
    const meta = await ownedChatThread(ctx, args.threadId, user.userId);
    if (!meta) return null;

    const buckets = new Map<
      string,
      {
        provider: string;
        model: string;
        voice?: string;
        characters: number;
        costCents: number;
        chunkCount: number;
      }
    >();
    let totalCharacters = 0;
    let totalCostCents = 0;
    let totalChunkCount = 0;

    for await (const row of ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_message', (q) => q.eq('messageId', args.messageId))) {
      if (row.threadId !== args.threadId) continue;
      if (meta.organizationId && row.organizationId !== meta.organizationId) {
        continue;
      }
      if (row.status !== 'ready') continue;
      // `characterCount` / `costEstimateCents` are only populated on chunks
      // synthesised after the schema gained those fields; legacy ready
      // chunks have no billing data on the row and would have to be
      // back-resolved from `usageLedger` (which is bucketed by period, not
      // message). Skip them — the dialog hides the section if all chunks
      // are legacy.
      if (
        row.characterCount === undefined ||
        row.costEstimateCents === undefined
      ) {
        continue;
      }
      if (row.providerName === undefined || row.modelId === undefined) continue;

      const key = `${row.providerName}::${row.modelId}::${row.voice ?? ''}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          provider: row.providerName,
          model: row.modelId,
          voice: row.voice,
          characters: 0,
          costCents: 0,
          chunkCount: 0,
        };
        buckets.set(key, bucket);
      }
      bucket.characters += row.characterCount;
      bucket.costCents += row.costEstimateCents;
      bucket.chunkCount += 1;
      totalCharacters += row.characterCount;
      totalCostCents += row.costEstimateCents;
      totalChunkCount += 1;
    }

    if (totalChunkCount === 0) return null;

    const breakdown = [...buckets.values()].sort(
      (a, b) =>
        b.costCents - a.costCents ||
        b.characters - a.characters ||
        a.provider.localeCompare(b.provider) ||
        a.model.localeCompare(b.model),
    );

    return {
      totalCharacters,
      totalCostCents,
      chunkCount: totalChunkCount,
      breakdown,
    };
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
      // Owning org + declared MIME so the route can stream an `s3:`-backed
      // chunk (whose bytes carry no stored content type) through the node
      // read lane. Deliberately NOT a presigned redirect — the URL must stay
      // cookie-bound and non-replayable (see the route's doc comment).
      organizationId: v.string(),
      contentType: v.string(),
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

    return {
      storageId: chunk.storageId,
      organizationId: chunk.organizationId,
      contentType:
        (chunk.format !== undefined
          ? AUDIO_MIME_BY_FORMAT[chunk.format]
          : undefined) ?? 'application/octet-stream',
    };
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
  const policy = await readConfigCacheRow(
    ctx.db,
    organizationId,
    'governance',
    'voice_output',
  );
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
 * Effective voice-mode setting for the chat UI — the composer's "Read
 * replies aloud" checkbox and the auto-chunk hook both drive off this.
 *
 * Precedence (top wins):
 *  1. org `policyType: 'voice_output'` veto (`config.enabled === false`)
 *     — admin kill switch; overrides every user/thread setting.
 *  2. `threads.voiceOutputOverride` — per-conversation override. When set
 *     (true/false) it wins over the user master switch; unset falls
 *     through. The composer always surfaces the toggle (except under org
 *     veto), so a stale override can't auto-play without a mute control.
 *  3. `userPreferences.voiceOutput` — per-user master switch.
 *  4. Default `false`.
 *
 * `threadId` is optional so the chat INDEX (no conversation yet) still
 * resolves the veto and the user default for its checkbox.
 */
export const getVoiceModeEffective = query({
  args: { organizationId: v.string(), threadId: v.optional(v.string()) },
  returns: v.object({
    enabled: v.boolean(),
    // `userDefault` exposes the raw master switch so callers can tell
    // "master OFF + thread override ON" apart from "master ON, no override".
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
    await getOrganizationMember(ctx, args.organizationId);

    // Org-level kill switch runs first — it vetoes every other setting.
    const orgEnabled = await isVoiceOutputOrgEnabled(ctx, args.organizationId);
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
        q.eq('userId', user.userId).eq('organizationId', args.organizationId),
      )
      .first();
    const userDefault = prefs?.voiceOutput === true;

    const meta =
      args.threadId !== undefined
        ? await ownedChatThread(ctx, args.threadId, user.userId)
        : null;
    if (
      meta &&
      meta.organizationId === args.organizationId &&
      typeof meta.voiceOutputOverride === 'boolean'
    ) {
      return {
        enabled: meta.voiceOutputOverride,
        userDefault,
        source: 'thread' as const,
      };
    }
    return {
      enabled: userDefault,
      userDefault,
      source: prefs ? ('preferences' as const) : ('default' as const),
    };
  },
});

/**
 * The chat-v2 ownership gate, query-side: the thread must be the CALLER'S
 * OWN live conversation — voice chunks and settings are the owner's, never
 * a shared viewer's. Null when it is not.
 */
async function ownedChatThread(
  ctx: QueryCtx,
  threadId: string,
  userId: string,
): Promise<Doc<'threads'> | null> {
  const normalized = ctx.db.normalizeId('threads', threadId);
  const thread = normalized ? await ctx.db.get(normalized) : null;
  if (
    !thread ||
    thread.userId !== userId ||
    thread.lifecycleStatus !== undefined
  ) {
    return null;
  }
  return thread;
}
