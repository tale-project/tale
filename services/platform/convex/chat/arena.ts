/**
 * Arena Mode — two threads answering the same prompts side by side.
 *
 * The pair is two ordinary `threads` rows: column A is the conversation the
 * user was in; column B a hidden copy of its history. Both carry the
 * `arena` object while the pair is live; settling removes it from both.
 * The exit is deliberately cheap — the verdict *chooses the surviving
 * thread*, so no message row ever moves: three patches and (with a verdict)
 * one `messageFeedback` insert.
 *
 * B is stamped `hidden: true` + `branchRootId: A` so the sidebar shows one
 * conversation and the trash cascade already carries the pair — but never
 * `branchParentId`, which is the marker the branch navigator uses, so the
 * arena column never surfaces as an edit sibling.
 */

import { v } from 'convex/values';

import {
  arenaFeedbackMessageId,
  ratingForVerdict,
  ARENA_VERDICTS,
} from '../../lib/shared/arena';
import type { Doc } from '../_generated/dataModel';
import { mutation, query, type MutationCtx } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { loadOwnedThread } from './threads';

const arenaVerdictValidator = v.union(
  ...ARENA_VERDICTS.map((verdict) => v.literal(verdict)),
);

async function requireOrgUser(
  ctx: Parameters<typeof getOrganizationMember>[0],
  organizationId: string,
): Promise<string> {
  const authUser = await getAuthUserIdentity(ctx);
  if (!authUser) throw new Error('Unauthenticated');
  await getOrganizationMember(ctx, organizationId, authUser);
  return authUser.userId;
}

function mintPairId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** The at-most-one-turn gate, read inside the settling transaction. */
async function hasLiveGeneration(
  ctx: MutationCtx,
  threadId: Doc<'threads'>['_id'],
): Promise<boolean> {
  const generation = await ctx.db
    .query('generations')
    .withIndex('by_thread', (q) => q.eq('threadId', threadId))
    .first();
  return generation !== null;
}

/** The newest assistant reply's model in a thread, for verdict attribution. */
async function newestAssistantModel(
  ctx: { db: MutationCtx['db'] },
  threadId: string,
): Promise<string | undefined> {
  for await (const message of ctx.db
    .query('messages')
    .withIndex('by_thread_sequence', (q) => q.eq('threadId', threadId))
    .order('desc')) {
    if (message.role === 'assistant' && message.model !== undefined) {
      return message.model;
    }
  }
  return undefined;
}

/**
 * Create (or return) the pair for a conversation. Column B copies A's whole
 * history — the comparison starts from shared context — with the title
 * copied so title generation never fires on the hidden side. Idempotent:
 * a thread already in a pair returns its existing partner.
 *
 * Refusals are structural, not transient: sandbox threads (turns run inside
 * a harness session, not a swappable model call), shared conversations
 * (a viewer would see half a pair), and a thread that is mid-generation.
 */
export const ensureArenaPair = mutation({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.union(
    v.object({ threadIdB: v.id('threads') }),
    v.object({ refused: v.string() }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (!thread) return { refused: 'not_found' };

    if (thread.arena !== undefined) {
      const partner = ctx.db.normalizeId(
        'threads',
        thread.arena.partnerThreadId,
      );
      const partnerRow = partner ? await ctx.db.get(partner) : null;
      if (partnerRow?.arena?.pairId === thread.arena.pairId && partner) {
        return {
          threadIdB: thread.arena.role === 'a' ? partner : thread._id,
        };
      }
      // Half-open pair (partner purged): heal by clearing and re-pairing.
      await ctx.db.patch(thread._id, { arena: undefined });
    }

    if (thread.kind === 'sandbox') return { refused: 'sandbox' };
    if (thread.isShared === true || thread.sharedWithProject === true) {
      return { refused: 'shared' };
    }
    if (thread.archived) return { refused: 'archived' };
    if (await hasLiveGeneration(ctx, thread._id)) {
      return { refused: 'busy' };
    }

    const now = Date.now();
    const pairId = mintPairId();
    // B ties into A's lineage for the trash cascade but deliberately owns
    // no project/share/voice state — the pair reads as ONE conversation
    // and every outward-facing property stays on A.
    const threadIdB = await ctx.db.insert('threads', {
      organizationId: thread.organizationId,
      userId,
      kind: thread.kind,
      title: thread.title,
      agentSlug: thread.agentSlug,
      capabilities: thread.capabilities,
      hidden: true,
      branchRootId: thread.branchRootId ?? String(thread._id),
      archived: false,
      createdAt: now,
      updatedAt: now,
    });

    const history = await ctx.db
      .query('messages')
      .withIndex('by_thread_sequence', (q) =>
        q.eq('threadId', String(thread._id)),
      )
      .collect();
    let sequence = 0;
    for (const message of history) {
      await ctx.db.insert('messages', {
        organizationId: message.organizationId,
        threadId: threadIdB,
        role: message.role,
        parts: message.parts,
        sequence,
        model: message.model,
        providerSlug: message.providerSlug,
        usage: message.usage,
        blockedReason: message.blockedReason,
        error: message.error,
        createdAt: now,
      });
      sequence += 1;
    }

    await ctx.db.patch(thread._id, {
      arena: {
        pairId,
        role: 'a' as const,
        partnerThreadId: String(threadIdB),
        createdAt: now,
      },
    });
    await ctx.db.patch(threadIdB, {
      arena: {
        pairId,
        role: 'b' as const,
        partnerThreadId: String(thread._id),
        createdAt: now,
      },
    });

    return { threadIdB };
  },
});

/**
 * The live pair as seen from either column. Null when the thread is not in
 * a pair or the pair is half-open — ABSENCE IS THE SIGNAL (the surface
 * reads it uncached), so a settled pair collapses the split view on every
 * subscribed tab at once.
 */
export const getArenaPair = query({
  args: { organizationId: v.string(), threadId: v.string() },
  returns: v.union(
    v.object({
      pairId: v.string(),
      threadIdA: v.string(),
      threadIdB: v.string(),
      createdAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (!thread || thread.arena === undefined) return null;

    const partnerId = ctx.db.normalizeId(
      'threads',
      thread.arena.partnerThreadId,
    );
    const partner = partnerId ? await ctx.db.get(partnerId) : null;
    if (
      !partner ||
      partner.arena?.pairId !== thread.arena.pairId ||
      partner.lifecycleStatus !== undefined
    ) {
      return null;
    }

    const { pairId, createdAt } = thread.arena;
    return thread.arena.role === 'a'
      ? {
          pairId,
          threadIdA: String(thread._id),
          threadIdB: String(partner._id),
          createdAt,
        }
      : {
          pairId,
          threadIdA: String(partner._id),
          threadIdB: String(thread._id),
          createdAt,
        };
  },
});

/**
 * Settle the pair. The verdict picks the surviving thread (`b_better` → B,
 * everything else → A; no verdict = exit → A). The loser goes
 * `hidden + archived` with its `arena` cleared — invisible everywhere, and
 * either trash-cascaded with A's lineage (a losing B keeps `branchRootId`)
 * or reaped by retention (a losing A). A verdict also records itself as a
 * `messageFeedback` row in the SAME transaction, in the exact shape the
 * feedback analytics reader counts (synthetic `arena:` message id +
 * `metadata.{arenaVerdict, modelA, modelB}`).
 */
export const settleArenaPair = mutation({
  args: {
    organizationId: v.string(),
    threadId: v.string(),
    verdict: v.optional(arenaVerdictValidator),
  },
  returns: v.union(
    v.object({ continueThreadId: v.id('threads') }),
    v.object({ refused: v.string() }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireOrgUser(ctx, args.organizationId);
    const thread = await loadOwnedThread(
      ctx,
      args.organizationId,
      userId,
      args.threadId,
    );
    if (!thread || thread.arena === undefined) return { refused: 'not_found' };

    const partnerId = ctx.db.normalizeId(
      'threads',
      thread.arena.partnerThreadId,
    );
    const partner = partnerId ? await ctx.db.get(partnerId) : null;
    if (!partner || partner.arena?.pairId !== thread.arena.pairId) {
      // Half-open pair: clear the marker so the surface recovers.
      await ctx.db.patch(thread._id, { arena: undefined });
      return { refused: 'not_found' };
    }

    const a = thread.arena.role === 'a' ? thread : partner;
    const b = thread.arena.role === 'a' ? partner : thread;

    // A verdict about answers mid-flight would rate an unfinished reply.
    if (
      (await hasLiveGeneration(ctx, a._id)) ||
      (await hasLiveGeneration(ctx, b._id))
    ) {
      return { refused: 'busy' };
    }

    const winner = args.verdict === 'b_better' ? b : a;
    const loser = winner._id === a._id ? b : a;

    await ctx.db.patch(loser._id, {
      arena: undefined,
      hidden: true as const,
      archived: true,
    });
    if (winner._id === b._id) {
      // B graduates to a standalone visible conversation. The losing A stays
      // a hidden root until retention reaps it.
      await ctx.db.patch(b._id, {
        arena: undefined,
        hidden: undefined,
        branchRootId: undefined,
      });
    } else {
      await ctx.db.patch(a._id, { arena: undefined });
    }

    if (args.verdict !== undefined) {
      const modelA = await newestAssistantModel(ctx, String(a._id));
      const modelB = await newestAssistantModel(ctx, String(b._id));
      // Attribution needs both sides to have answered; an aborted pair
      // settles without a data point.
      if (modelA !== undefined && modelB !== undefined) {
        await ctx.db.insert('messageFeedback', {
          organizationId: args.organizationId,
          threadId: String(a._id),
          messageId: arenaFeedbackMessageId(modelA, modelB),
          userId,
          rating: ratingForVerdict(args.verdict),
          metadata: {
            arenaVerdict: args.verdict,
            modelA,
            modelB,
          },
          createdAt: Date.now(),
        });
      }
    }

    return { continueThreadId: winner._id };
  },
});

/** The share/branch/archive guard: a thread in a live pair refuses outward-
 * facing state changes — settle the arena first. */
export function assertNotInArena(thread: Doc<'threads'>): boolean {
  return thread.arena === undefined;
}
