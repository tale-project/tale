import { ConvexError, v } from 'convex/values';

import {
  MAX_TTS_CHARS_PER_MESSAGE,
  MAX_TTS_CHUNKS_PER_MESSAGE,
  TTS_FETCH_TIMEOUT_MS,
  TTS_WATCHDOG_BUFFER_MS,
} from '../../lib/shared/constants/tts';
import { audioFormatLiterals } from '../../lib/shared/schemas/providers';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import {
  type MutationCtx,
  internalMutation,
  mutation,
} from '../_generated/server';
import { logDenied } from '../audit_logs/helpers';
import { checkBudget } from '../governance/budget_enforcement';
import { estimateTtsCostCents } from '../governance/cost_estimation';
import { recordTtsUsageInline } from '../governance/internal_mutations';
import { resolveBudgetContext } from '../governance/resolve_budget_context';
import { rateLimiter } from '../lib/rate_limiter';
import { assertSelfAndOrgMember } from '../lib/rls/auth/assert_self_and_org_member';
import { assertThreadAccess } from '../lib/rls/auth/can_access_thread';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { sanitizeError } from '../lib/utils/sanitize_secrets';
import { ttsErrorCodeLiterals } from './error_codes';

// Lazy GC parameters. ~7-day retention matches the schema docstring;
// PASS_LIMIT bounds work per trigger so a backlog doesn't stall a sweep.
const CHUNK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_PASS_LIMIT = 64;

/**
 * Conservative cents-per-million-characters used for the *prospective*
 * budget check inside `reserveChunk`. The real per-model rate isn't known
 * until the action's `resolveTtsModel` runs, so we use a high upper-mid
 * estimate (matches OpenAI `tts-1` list pricing) so the cap errs on the
 * side of refusing a marginal chunk rather than letting a parallel burst
 * sneak past the limit. The post-call ledger entry uses the precise
 * per-model rate, so the over-estimate is only a gating signal, never a
 * billing inaccuracy.
 */
const PROSPECTIVE_TTS_CENTS_PER_M_CHARS = 1500;

// Pending-watchdog horizon. Derived from `TTS_FETCH_TIMEOUT_MS` so a
// chunk whose action timed out (provider hang for the full 60s) plus
// generous teardown slack is still considered live, but a crashed /
// killed action becomes overwritable within 90s instead of stranding
// the chunk row in `pending` for three minutes. Co-locating with the
// fetch timeout in `lib/shared/constants/tts.ts` prevents the two from
// silently drifting on a future tuning pass.
const PENDING_STALE_MS = TTS_FETCH_TIMEOUT_MS + 30_000;

/**
 * Schedule the opportunistic cleanup sweep for `threadId`. Wrapped here
 * because both the success path (`markChunkReadyAndRecordUsage`) and the
 * failure path (`markChunkFailed`) need the same try/catch + arg shape, and
 * the `cleanup:tts` limiter gates the actual sweep to ~1/hour/thread anyway.
 * A scheduler hiccup must not roll back the calling mutation — the daily
 * `gcOrgTtsChunks` cron is the authoritative sweep backstop.
 */
async function scheduleOpportunisticCleanup(
  ctx: MutationCtx,
  threadId: string,
  source: string,
): Promise<void> {
  try {
    await ctx.scheduler.runAfter(0, internal.tts.mutations.maybeCleanupChunks, {
      threadId,
      olderThanMs: CHUNK_RETENTION_MS,
      limit: CLEANUP_PASS_LIMIT,
    });
  } catch (err) {
    console.warn(
      `[${source}] failed to schedule maybeCleanupChunks; daily cron will catch the backlog`,
      sanitizeError(err),
    );
  }
}

/**
 * Schedule the stuck-pending watchdog for a freshly-reserved chunk. If the
 * action completes (mark-ready or mark-failed) before the watchdog fires,
 * the watchdog no-ops via `markChunkFailed`'s `(chunkId, attemptCreatedAt)`
 * identity gate. If the action crashes after `ctx.storage.store` but before
 * `markChunkReadyAndRecordUsage`, the watchdog flips the row to `failed`
 * with `WATCHDOG_TIMEOUT` so the player advances instead of parking on a
 * forever-pending row until the daily org-sweep cron.
 *
 * The 90s+5s horizon is intentionally slack — short enough that a crashed
 * action doesn't strand the UI for minutes, long enough that the legitimate
 * 60s provider call plus full teardown never trips it.
 */
async function scheduleWatchdog(
  ctx: MutationCtx,
  chunkId: Id<'ttsAudioChunks'>,
  attemptCreatedAt: number,
): Promise<void> {
  try {
    await ctx.scheduler.runAfter(
      PENDING_STALE_MS + TTS_WATCHDOG_BUFFER_MS,
      internal.tts.mutations.markChunkFailed,
      {
        chunkId,
        attemptCreatedAt,
        error: 'WATCHDOG_TIMEOUT' as const,
      },
    );
  } catch (err) {
    console.warn(
      '[tts.reserveChunk] failed to schedule watchdog; row will rely on stale-pending overwrite at PENDING_STALE_MS',
      sanitizeError(err),
    );
  }
}

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
 *  - `{ kind: 'reserved', chunkId, attemptCreatedAt, organizationId, userId,
 *      teamId }` — fresh reservation
 *
 * This is the single gate for every TTS synthesis: it (a) authenticates the
 * caller, (b) verifies thread access and derives the canonical organizationId
 * from thread metadata (never trusting the client arg), (c) cross-checks
 * identity on collision with an existing row and short-circuits on cache hits
 * before any cost is debited, (d) enforces per-user and per-org rate limits,
 * (e) consults org budget policy, and (f) caps chunks per message.
 *
 * Cache-then-debit ordering: existing-row lookup runs BEFORE the rate-limiter
 * and budget checks. Reactive client subscriptions can re-fire `synthesizeChunk`
 * for chunks that are already `'ready'` (e.g. on thread revisit) and that path
 * must not consume tokens or trip the budget — only fresh work does.
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
    // Per-model rate the action resolved before calling this mutation. When
    // provided, used as the prospective-cost rate for the budget check
    // instead of `PROSPECTIVE_TTS_CENTS_PER_M_CHARS`. Optional because the
    // action may not have resolved the model yet (cache-hit / pending-in-
    // flight short-circuits skip the resolver). Leaving it at the static
    // default for those paths is fine — they don't bill, so the check is
    // moot anyway.
    prospectiveCostCentsPerMChars: v.optional(v.number()),
  },
  returns: v.union(
    v.object({
      kind: v.literal('ready'),
      storageId: v.id('_storage'),
      voice: v.optional(v.string()),
      format: v.optional(
        v.union(...audioFormatLiterals.map((literal) => v.literal(literal))),
      ),
    }),
    v.object({ kind: v.literal('pending-in-flight') }),
    v.object({
      kind: v.literal('reserved'),
      chunkId: v.id('ttsAudioChunks'),
      attemptCreatedAt: v.number(),
      organizationId: v.string(),
      userId: v.string(),
      teamId: v.optional(v.string()),
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
      args.index >= MAX_TTS_CHUNKS_PER_MESSAGE
    ) {
      throw new ConvexError({
        code: 'TTS_CHUNK_LIMIT',
        message: `TTS chunk index must be in [0, ${MAX_TTS_CHUNKS_PER_MESSAGE}).`,
      });
    }

    // Existing-row lookup runs BEFORE cost gates so re-subscribers don't burn
    // rate-limit tokens / trip budget checks on cache hits. Cross-field
    // identity check defends against a leaked / guessed `messageId` paired
    // with a thread the caller *can* access — `messageId` is `v.string()`,
    // not an `_id`, so the index alone does not pin identity.
    const existing = await ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_message', (q) =>
        q.eq('messageId', args.messageId).eq('index', args.index),
      )
      .first();
    if (existing) {
      if (
        existing.threadId !== args.threadId ||
        existing.organizationId !== organizationId
      ) {
        // Identity mismatch is a security signal: the caller knows a
        // `messageId` that exists in a different thread / org. Audit so
        // operators can correlate repeated probes with a specific user.
        await logDenied(ctx, {
          auditCtx: {
            organizationId,
            actor: {
              id: user.userId,
              email: user.email,
              role: undefined,
              type: 'user',
            },
          },
          action: 'tts.synthesize_denied',
          category: 'security',
          resourceType: 'tts_audio_chunk',
          resourceId: existing._id,
          reason: 'identity_mismatch',
          metadata: {
            requestedMessageId: args.messageId,
            requestedThreadId: args.threadId,
            ownedThreadId: existing.threadId,
            ownedOrganizationId: existing.organizationId,
          },
        });
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
        // retry. Falls through to the overwrite branch below, which (a)
        // refreshes `attemptCreatedAt` so the prior attempt can no longer
        // land its `markChunkReady`/`markChunkFailed`, and (b) deletes any
        // half-uploaded `_storage` blob so it doesn't leak.
      }
    }

    // Per-message character cap: aggregates `text.length` across every chunk
    // already reserved for this message and refuses if the new chunk would
    // push the total over `MAX_TTS_CHARS_PER_MESSAGE`. Bounds worst-case
    // spend per single assistant reply — at OpenAI tts-1 rates, the 50k
    // cap holds one reply under ~$0.75. The full structural fix is the
    // deferred two-component pricing model.
    //
    // Existing rows are counted via the cheap `by_message` index. Counts the
    // new chunk's own text on top so a single oversize chunk still trips.
    // Early-exit the loop once the running total + the new chunk exceeds
    // the cap — the check is the same per row, so completing the scan
    // after we've already decided to refuse is wasted work. Bounded
    // today by the 200-chunk ceiling but the quadratic shape on a future
    // cap bump is what the early-exit defends against. m9.
    let existingChars = 0;
    let capExceeded = false;
    for await (const row of ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_message', (q) => q.eq('messageId', args.messageId))) {
      if (row.threadId !== args.threadId) continue;
      if (row.organizationId !== organizationId) continue;
      // Skip the row we're about to overwrite — its old text is being
      // replaced, not added to.
      if (existing && row._id === existing._id) continue;
      // Skip terminally-failed rows that never made it to the ledger.
      // They never billed the org and the user is likely retrying after
      // fixing config (provider key, voice spelling, etc.); counting
      // them would let a sequence of repaired retries falsely trip the
      // per-message cap. Pending and ready rows still count.
      if (row.status === 'failed' && row.usageRecordedAt === undefined) {
        continue;
      }
      existingChars += row.text.length;
      if (existingChars + args.text.length > MAX_TTS_CHARS_PER_MESSAGE) {
        capExceeded = true;
        break;
      }
    }
    if (capExceeded) {
      throw new ConvexError({
        code: 'MESSAGE_CHAR_LIMIT',
        message: `TTS character limit reached for this message (cap ${MAX_TTS_CHARS_PER_MESSAGE}).`,
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
    const teamId = userTeamIds[0];
    // Prospective-cost projection: add the about-to-fire chunk's estimated
    // cost so parallel chunks of one message can't each individually pass
    // and collectively overshoot. The action's post-call ledger write uses
    // the precise per-model rate; this estimate only gates whether we
    // attempt the call at all.
    const prospectiveCostCents = estimateTtsCostCents(
      args.text.length,
      args.prospectiveCostCentsPerMChars ?? PROSPECTIVE_TTS_CENTS_PER_M_CHARS,
    );
    const budget = await checkBudget(
      ctx,
      organizationId,
      user.userId,
      userTeamIds,
      userRole,
      prospectiveCostCents,
      // The action's post-success ledger write adds exactly one
      // request-count to the row. Plumb the +1 here so a `maxRequests`
      // rule honours parallel chunks of a single message the same way
      // `maxCostCents` does — without it, N concurrent chunks each
      // saw `requestCount` unchanged and collectively overran the cap.
      1,
    );
    if (!budget.allowed) {
      throw new ConvexError({
        code: 'BUDGET_EXCEEDED',
        message:
          budget.reason ??
          'TTS budget exceeded for this period. Contact your administrator.',
      });
    }

    const attemptCreatedAt = Date.now();

    if (existing) {
      // Previously failed (or stale-pending) — overwrite to retry. Reset every
      // result-bearing field so a provider switch / model swap can't leave
      // stale metadata around for a query subscriber to read.
      //
      // Storage-orphan compensation: if the prior attempt had uploaded a
      // blob (e.g. it succeeded at `ctx.storage.store` but crashed before
      // `markChunkReady`), delete it now. Without this, every stale-pending
      // retry that follows the upload step would leak its blob until the
      // 7-day org sweep eventually catches it.
      if (existing.storageId) {
        try {
          await ctx.storage.delete(existing.storageId);
        } catch (err) {
          console.warn(
            '[tts.reserveChunk] failed to delete prior blob',
            sanitizeError(err),
          );
        }
      }
      await ctx.db.patch(existing._id, {
        status: 'pending' as const,
        error: undefined,
        text: args.text,
        locale: args.locale,
        createdAt: attemptCreatedAt,
        attemptCreatedAt,
        usageRecordedAt: undefined,
        voice: undefined,
        providerName: undefined,
        modelId: undefined,
        format: undefined,
        storageId: undefined,
        userId: user.userId,
        teamId,
        // `?? existing.agentSlug` preserves the original attribution
        // when the thread temporarily reports no agent on a retry
        // (agent detached between attempts). The chunk row's agentSlug
        // is retained for debugging / future per-agent voice analytics;
        // ledger bucketing itself always routes TTS rows under
        // TTS_SLUG regardless of this field.
        agentSlug: meta.agentSlug ?? existing.agentSlug,
      });
      await scheduleWatchdog(ctx, existing._id, attemptCreatedAt);
      return {
        kind: 'reserved' as const,
        chunkId: existing._id,
        attemptCreatedAt,
        organizationId,
        userId: user.userId,
        teamId,
      };
    }
    const chunkId = await ctx.db.insert('ttsAudioChunks', {
      messageId: args.messageId,
      threadId: args.threadId,
      organizationId,
      userId: user.userId,
      teamId,
      agentSlug: meta.agentSlug,
      index: args.index,
      text: args.text,
      status: 'pending',
      locale: args.locale,
      createdAt: attemptCreatedAt,
      attemptCreatedAt,
    });
    await scheduleWatchdog(ctx, chunkId, attemptCreatedAt);
    // Post-insert dedupe: Convex has no unique index, and the initial
    // `existing` lookup at the top of this handler can miss a row that a
    // concurrent transaction inserted in parallel — both writers see no
    // existing row, both insert. Re-query by `(messageId, index)` after
    // our insert; if more than one row materialised, deterministically
    // keep the earliest by `_creationTime` and drop the rest (including
    // possibly our own row). Convex serialises writes per-document but
    // not across the indexed range, so this is the smallest contract we
    // can enforce without a serialising rate-limiter on every reserve.
    const sameKey = await ctx.db
      .query('ttsAudioChunks')
      .withIndex('by_message', (q) =>
        q.eq('messageId', args.messageId).eq('index', args.index),
      )
      .collect();
    if (sameKey.length > 1) {
      sameKey.sort((a, b) => a._creationTime - b._creationTime);
      const winner = sameKey[0];
      for (const dup of sameKey.slice(1)) {
        // db.delete first; storage.delete is best-effort (no blob is
        // attached at reserve-time anyway since storageId is filled in
        // by markChunkReadyAndRecordUsage, but guard for safety).
        await ctx.db.delete(dup._id);
        if (dup.storageId) {
          try {
            await ctx.storage.delete(dup.storageId);
          } catch (err) {
            console.warn(
              '[tts.reserveChunk] dedupe storage.delete failed',
              sanitizeError(err),
            );
          }
        }
      }
      // Cross-field identity guard mirrors the early-`existing` path —
      // refuse to hand back a row whose thread/org doesn't match the
      // caller's claim. Eliminates the case where both racers belonged
      // to different threads (theoretically impossible under current
      // call paths but defended for symmetry).
      if (
        winner.threadId !== args.threadId ||
        winner.organizationId !== organizationId
      ) {
        throw new ConvexError({
          code: 'forbidden',
          message: 'TTS chunk identity mismatch after dedupe.',
        });
      }
      return {
        kind: 'reserved' as const,
        chunkId: winner._id,
        attemptCreatedAt: winner.attemptCreatedAt ?? winner.createdAt,
        organizationId,
        userId: user.userId,
        teamId,
      };
    }
    return {
      kind: 'reserved' as const,
      chunkId,
      attemptCreatedAt,
      organizationId,
      userId: user.userId,
      teamId,
    };
  },
});

/**
 * Internal: atomically flip a chunk to `'ready'`, write its ledger row, and
 * schedule cleanup. Combining these into one mutation closes three confirmed
 * round-2 hazards in a single shot:
 *
 *  1. **PII cross-talk** — a stale attempt holding the prior `attemptCreatedAt`
 *     can no longer land its `markChunkReady` on a freshly-overwritten row
 *     because the identity check refuses the write.
 *  2. **Ledger atomicity** — the storage flip and the ledger insert run in
 *     one transaction, so an action crash between them can no longer leave
 *     audio billed but un-recorded (or, conversely, recorded but never
 *     surfaced to the user).
 *  3. **Cleanup-dispatch storm** — the per-chunk `scheduler.runAfter` is
 *     gated on `index === 0`, so a 200-chunk reply schedules one sweep
 *     instead of 200.
 *
 * On identity-mismatch (stale attempt), the mutation deletes the incoming
 * `storageId` blob inline and returns `{ stale: true }` so the action knows
 * not to surface the result.
 */
export const markChunkReadyAndRecordUsage = internalMutation({
  args: {
    chunkId: v.id('ttsAudioChunks'),
    attemptCreatedAt: v.number(),
    storageId: v.id('_storage'),
    voice: v.string(),
    providerName: v.string(),
    modelId: v.string(),
    format: v.union(
      ...audioFormatLiterals.map((literal) => v.literal(literal)),
    ),
    characterCount: v.number(),
    costEstimateCents: v.number(),
  },
  returns: v.object({ stale: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.chunkId);
    if (
      !row ||
      row.status !== 'pending' ||
      row.attemptCreatedAt !== args.attemptCreatedAt
    ) {
      // Stale attempt or row vanished (cascade deleted, etc.). Delete the
      // incoming blob inline so it doesn't leak — no other code path
      // references it.
      try {
        await ctx.storage.delete(args.storageId);
      } catch (err) {
        console.warn(
          '[tts.markReady] failed to delete stale blob',
          sanitizeError(err),
        );
      }
      return { stale: true };
    }

    // `reserveChunk` always writes `userId` on both insert and overwrite
    // branches, so a `pending` row reaching this point without it is a
    // bug. Refuse the ready-patch so the audio is never playable without
    // a billed ledger row. Convex rolls the whole transaction back on
    // the throw below, so we don't pre-patch the row to `'failed'`
    // (any such patch would itself roll back and leave the row in
    // `pending`). The watchdog (`scheduleWatchdog` / `mutations.ts:105`)
    // flips it to `WATCHDOG_TIMEOUT` on its next pass, which is the
    // intended terminal state. The caller (synthesize.ts) catches the
    // throw, deletes the just-uploaded blob, and surfaces a generic
    // failure to the client.
    if (!row.userId) {
      console.error(
        '[tts.markReady] pending row missing userId; refusing ledger-less playback',
        { chunkId: args.chunkId },
      );
      throw new ConvexError({
        code: 'TTS_USERID_MISSING',
        message: 'pending row missing userId',
      });
    }

    // Note: we deliberately don't pre-resolve a storage URL. The
    // `audioUrl` field on the schema is deprecated — subscribers fetch
    // audio through the authenticated `/api/tts-audio` route keyed on
    // `chunkId`. Skipping the URL pre-resolution saves one round-trip
    // per chunk write and matches the security model (per-request
    // membership check beats bearer-replayable URL).
    await ctx.db.patch(args.chunkId, {
      status: 'ready',
      storageId: args.storageId,
      voice: args.voice,
      providerName: args.providerName,
      modelId: args.modelId,
      format: args.format,
      characterCount: args.characterCount,
      costEstimateCents: args.costEstimateCents,
      error: undefined,
      usageRecordedAt: Date.now(),
    });

    // Ledger rows for TTS are always bucketed under the `TTS_SLUG` sentinel
    // so Top Assistants surfaces voice cost as its own row instead of folding
    // it silently into the calling agent. The writer no longer takes an
    // `agentSlug` arg — see `recordTtsUsageInline`.
    await recordTtsUsageInline(ctx, {
      organizationId: row.organizationId,
      userId: row.userId,
      teamId: row.teamId,
      model: args.modelId,
      provider: args.providerName,
      characterCount: args.characterCount,
      costEstimateCents: args.costEstimateCents,
      timestamp: Date.now(),
    });

    // Schedule cleanup only on chunk 0: every chunk firing the scheduler
    // would mean 200 throwaway dispatches per long message, of which only
    // the first does any real work (the `cleanup:tts` limiter gates the
    // rest). Doing it once per message keeps the dispatcher backlog small.
    if (row.index === 0) {
      await scheduleOpportunisticCleanup(ctx, row.threadId, 'tts.markReady');
    }

    return { stale: false };
  },
});

/**
 * Internal: write an audit-log row for a denied `getCapability` call.
 * Called from the action's catch branch when the membership-gate query
 * rejects — without this audit signal, an authenticated user probing
 * arbitrary org IDs to enumerate provider configurations leaves no
 * forensic trail. Best-effort: failure to write the audit row is swallowed
 * so the original deny propagates to the client.
 */
export const logCapabilityProbeDenied = internalMutation({
  args: {
    organizationId: v.string(),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      await logDenied(ctx, {
        auditCtx: {
          organizationId: args.organizationId,
          actor: {
            id: args.actorId,
            email: args.actorEmail,
            role: undefined,
            type: 'user',
          },
        },
        action: 'tts.capability_probe_denied',
        category: 'security',
        resourceType: 'tts_capability',
        resourceId: args.organizationId,
        reason: 'not_org_member',
      });
    } catch (err) {
      console.warn(
        '[tts.logCapabilityProbeDenied] audit write failed',
        sanitizeError(err),
      );
    }
    return null;
  },
});

/**
 * Internal: flip a chunk to `'failed'` with a stable error code. `error` MUST
 * be a `TtsErrorCode` enum literal (see `synthesize.ts`) — no free-form
 * detail. The field is surfaced to every member of the org via
 * `getMessageChunks`, so any free-form text risks leaking provider hostnames,
 * input PII echoed in upstream error bodies, or sensitive config. Free-form
 * detail belongs in `console.error` (sanitized) only.
 *
 * Identity contract: refuses to write when `attemptCreatedAt` doesn't match
 * the row, so a stale attempt's late failure can't override a fresh attempt
 * that has already succeeded or failed under a new code.
 */
export const markChunkFailed = internalMutation({
  args: {
    chunkId: v.id('ttsAudioChunks'),
    attemptCreatedAt: v.number(),
    // Narrowed to the closed `TtsErrorCode` union — see `schema.ts`. A
    // wider `v.string()` here would silently bypass the schema's
    // `v.union(...)` validator at the patch site below and leak free-
    // form text (potential PII) into the fan-out `getMessageChunks`
    // subscription.
    error: v.union(
      ...ttsErrorCodeLiterals.map((literal) => v.literal(literal)),
    ),
  },
  returns: v.object({ stale: v.boolean() }),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.chunkId);
    if (
      !row ||
      row.status !== 'pending' ||
      row.attemptCreatedAt !== args.attemptCreatedAt
    ) {
      return { stale: true };
    }
    await ctx.db.patch(args.chunkId, {
      status: 'failed',
      error: args.error,
    });

    // Schedule opportunistic cleanup from the failure path too — same
    // shape as the success path in `markChunkReadyAndRecordUsage`.
    // Without this, a message whose chunk 0 always fails (provider
    // outage, host-policy reject) never triggers any opportunistic
    // sweep and the daily cron is the only backstop. The `cleanup:tts`
    // limiter still gates this to ~1/hour/thread so a burst of
    // failures doesn't flood the dispatcher.
    if (row.index === 0) {
      await scheduleOpportunisticCleanup(
        ctx,
        row.threadId,
        'tts.markChunkFailed',
      );
    }

    return { stale: false };
  },
});

/**
 * Opportunistic cleanup trigger scheduled from
 * `markChunkReadyAndRecordUsage` (success) or `markChunkFailed` (failure),
 * gated on `index === 0` in both.
 * Rate-limited via the `cleanup:tts` token (one pass per thread per hour)
 * so a burst of message-zero flips can't dispatch many sweeps in quick
 * succession. Returns silently when the limiter gates the call.
 *
 * Idle threads — those that synthesize once and stop — never trigger this
 * mutation again. The daily `gcOrgTtsChunks` cron in `crons.ts` is the
 * cross-thread backstop that reaps them on the retention horizon.
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
          console.warn(
            '[tts.cleanup] failed to delete storage blob',
            sanitizeError(err),
          );
        }
      }
      await ctx.db.delete(row._id);
    }
    return null;
  },
});
