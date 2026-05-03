import { v } from 'convex/values';

import { internal } from '../_generated/api';
import { internalMutation } from '../_generated/server';
import { estimateTokens } from '../lib/context_management/estimate_tokens';
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
 * Internal write path for the `propose_memory` agent tool. Bypasses public
 * auth (the caller is the chat action runtime, which has already validated
 * the user) but still enforces:
 *
 *  - Org-membership: rejects if the (userId, organizationId) tuple is no
 *    longer a current member of the org. Defense against a stale agent
 *    runtime context after a member was removed.
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

    // Temp-chat / per-thread opt-out gate. Even if the agent has the tool,
    // writes against an opted-out thread are rejected — the proposal would
    // never be visible to the user via listPendingMemories anyway, so we
    // reject early to avoid orphaned rows.
    const threadMeta = await ctx.db
      .query('threadMetadata')
      .withIndex('by_threadId', (q) => q.eq('threadId', args.threadId))
      .first();
    if (threadMeta?.disablePersonalization === true) {
      await audit('denied');
      return {
        ok: false,
        reason: 'This thread has personalization disabled.',
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

    // Per-day cap: count `propose` audit rows for this user+org in the
    // last 24h. Audit rows are pseudonymised so we look up by org +
    // subjectUserIdHmac. We don't have the HMAC inline; cheaper to count
    // the actual memory rows that started as proposals in the window.
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
