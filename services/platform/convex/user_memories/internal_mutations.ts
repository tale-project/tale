import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { estimateTokens } from '../lib/context_management/estimate_tokens';
import { evaluatePersonalizationGates } from '../personalization/internal_queries';
import {
  ILLEGAL_CONTENT_RE,
  MEMORY_CONTENT_MAX_TOKENS,
  PROPOSAL_DAY_WINDOW_MS,
} from './constants';
import { maybeRunCleanup } from './lazy_cleanup';

interface WriteProposalResult {
  ok: boolean;
  reason: string;
  memoryId?: string;
}

/**
 * Internal write path for the `propose_memory` agent tool. Bypasses
 * public auth (the caller is the chat action runtime, which has already
 * validated the user) but still enforces:
 *
 *  - Same kill-switch gate as the read path: org feature flag,
 *    `prefs.enabled === true`, and `!threadMetadata.disablePersonalization`.
 *    Default-OFF: a missing prefs row blocks the write. Membership is
 *    transitively covered because `cascadeOnMemberRemoved` deletes the
 *    user's prefs row when they leave the org.
 *  - Content shape: same regex/token caps the public mutations apply.
 *  - Rate limits: per-thread (≤ 3 pending) and per-(user, org) per 24h
 *    (≤ 20 proposals total).
 *  - Audit: writes one row per outcome (`propose` / ok or `propose` /
 *    denied with reason; never logs content).
 */
export const writeProposal = internalMutation({
  args: {
    userId: v.string(),
    organizationId: v.string(),
    threadId: v.string(),
    messageId: v.optional(v.string()),
    content: v.string(),
    pendingTtlMs: v.number(),
    perThreadCap: v.number(),
    perDayCap: v.number(),
  },
  handler: async (ctx, args): Promise<WriteProposalResult> => {
    const audit = async (
      outcome: 'ok' | 'denied' | 'error',
      memoryId?: string,
    ): Promise<void> => {
      await ctx.runMutation(
        internal.user_memory_audit_log.internal_mutations.appendAudit,
        {
          organizationId: args.organizationId,
          actorUserId: args.userId,
          subjectUserId: args.userId,
          action: 'propose',
          outcome,
          memoryId: memoryId
            ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- memoryId comes from ctx.db.insert
              (memoryId as never)
            : undefined,
          threadId: args.threadId,
          messageId: args.messageId,
        },
      );
    };

    // Read+write symmetry: same gate as buildUserPersonalization. Blocks
    // when the org has not opted in, the user has not enabled
    // personalization (default-OFF), the thread has been opted out, or
    // (transitively) the user is no longer an org member — the cascade
    // hook deletes their prefs row on removal.
    const allowed = await evaluatePersonalizationGates(ctx, {
      userId: args.userId,
      organizationId: args.organizationId,
      threadId: args.threadId,
    });
    if (!allowed) {
      await audit('denied');
      return {
        ok: false,
        reason:
          'Personalization is not enabled for this user, organization, or thread.',
      };
    }

    const trimmed = args.content.trim();
    if (!trimmed) {
      await audit('denied');
      return { ok: false, reason: 'Memory content is empty.' };
    }
    if (ILLEGAL_CONTENT_RE.test(trimmed)) {
      await audit('denied');
      return {
        ok: false,
        reason:
          'Memory content contains disallowed characters (newlines, angle ' +
          'brackets, backticks, or control characters).',
      };
    }
    if (estimateTokens(trimmed) > MEMORY_CONTENT_MAX_TOKENS) {
      await audit('denied');
      return {
        ok: false,
        reason: `Memory content exceeds the ${MEMORY_CONTENT_MAX_TOKENS} token limit.`,
      };
    }

    await maybeRunCleanup(ctx, args.userId, args.organizationId);

    const now = Date.now();

    // Per-thread cap: count current pending rows for this thread.
    const pendingForThread = await ctx.db
      .query('userMemories')
      .withIndex('by_user_org_status_deleted_created', (q) =>
        q
          .eq('userId', args.userId)
          .eq('organizationId', args.organizationId)
          .eq('status', 'pending'),
      )
      .collect();
    const livePendingForThread = pendingForThread.filter(
      (m) =>
        m.sourceThreadId === args.threadId &&
        typeof m.deletedAt !== 'number' &&
        (typeof m.pendingExpiresAt !== 'number' || m.pendingExpiresAt > now),
    );
    if (livePendingForThread.length >= args.perThreadCap) {
      await audit('denied');
      return {
        ok: false,
        reason: `Already ${livePendingForThread.length} pending proposals on this thread; resolve some before adding more.`,
      };
    }

    // Per-day cap: count `agent_proposed` memory rows for this user+org
    // created in the last 24h. (Commit 10 will switch this to count
    // `propose` audit rows so dismissed proposals still count toward the
    // cap.)
    const dayCutoff = now - PROPOSAL_DAY_WINDOW_MS;
    const recentByUser = await ctx.db
      .query('userMemories')
      .withIndex('by_user_org_status_deleted_created', (q) =>
        q.eq('userId', args.userId).eq('organizationId', args.organizationId),
      )
      .collect();
    const proposalsInWindow = recentByUser.filter(
      (m) => m.source === 'agent_proposed' && m.createdAt >= dayCutoff,
    );
    if (proposalsInWindow.length >= args.perDayCap) {
      await audit('denied');
      return {
        ok: false,
        reason: `Daily memory proposal cap (${args.perDayCap}) reached for this user+org.`,
      };
    }

    const memoryId = await ctx.db.insert('userMemories', {
      userId: args.userId,
      organizationId: args.organizationId,
      content: trimmed,
      source: 'agent_proposed',
      status: 'pending',
      sourceThreadId: args.threadId,
      sourceMessageId: args.messageId,
      pendingExpiresAt: now + args.pendingTtlMs,
      createdAt: now,
    });
    await audit('ok', String(memoryId));
    return { ok: true, reason: '', memoryId: String(memoryId) };
  },
});
