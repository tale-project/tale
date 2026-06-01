import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import type { MutationCtx } from '../../_generated/server';
import { internalMutation } from '../../_generated/server';
import { buildExternalOwnerId } from '../../identities/external_identities';
import { startAgentChat } from '../../lib/agent_chat';
import { rateLimiter } from '../../lib/rate_limiter';
import { createChatThread } from '../../threads/create_chat_thread';

// Slack retries deliveries for a few minutes; a 1h TTL is generously past that.
const DEDUP_TTL_MS = 60 * 60 * 1000;
// Bounded per-sweep delete count so each cleanup stays a quick mutation.
const DEDUP_GC_PER_SWEEP = 1000;

/**
 * Delete up to `DEDUP_GC_PER_SWEEP` expired dedup rows. Returns true when the
 * cap was hit and more expired rows likely remain (so the caller can continue
 * draining). Kept small and bounded so it never becomes a long mutation.
 */
async function sweepExpiredDedup(ctx: MutationCtx): Promise<boolean> {
  const now = Date.now();
  let deleted = 0;
  for await (const row of ctx.db
    .query('slackEventDedup')
    .withIndex('by_expiresAt', (q) => q.lte('expiresAt', now))
    .order('asc')) {
    await ctx.db.delete(row._id);
    deleted += 1;
    if (deleted >= DEDUP_GC_PER_SWEEP) break;
  }
  return deleted >= DEDUP_GC_PER_SWEEP;
}

/**
 * Opportunistic, rate-limiter-gated GC of expired dedup rows, run from the hot
 * claim path. The gate (token bucket, capacity 1) admits at most one sweep per
 * hour deployment-wide; when a single bounded sweep can't clear the backlog
 * (sustained high inbound volume), it schedules follow-up `drainSlackDedup`
 * mutations that keep draining WITHOUT re-consuming the hourly token — so the
 * table is reclaimed in minutes rather than capped at 1000 rows/hour. Stays
 * lazy/opportunistic: no cron. Best-effort — a missing limiter component
 * (e.g. a test ctx) skips the sweep rather than crashing the claim.
 */
async function maybeRunSlackDedupCleanup(ctx: MutationCtx): Promise<void> {
  let gate: { ok: boolean };
  try {
    gate = await rateLimiter.limit(ctx, 'cleanup:slack-dedup', {
      key: 'global',
      throws: false,
    });
  } catch (err) {
    console.warn('[slack.dedup.cleanup] rate-limiter gate failed:', err);
    return;
  }
  if (!gate.ok) return;

  const moreRemain = await sweepExpiredDedup(ctx);
  if (moreRemain) {
    await ctx.scheduler.runAfter(
      0,
      internal.integrations.slack.internal_mutations.drainSlackDedup,
      {},
    );
  }
}

/**
 * Continuation of the opportunistic dedup sweep. Drains the expired backlog in
 * bounded batches, rescheduling itself until empty. Not rate-limited — it only
 * runs after `maybeRunSlackDedupCleanup` has already spent the hourly token and
 * found more than one batch to reap.
 */
export const drainSlackDedup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const moreRemain = await sweepExpiredDedup(ctx);
    if (moreRemain) {
      await ctx.scheduler.runAfter(
        0,
        internal.integrations.slack.internal_mutations.drainSlackDedup,
        {},
      );
    }
    return null;
  },
});

/**
 * Authoritative idempotency gate for inbound Slack events. Query-then-insert in
 * one mutation is race-free under Convex OCC: a concurrent duplicate is retried
 * and then sees the row. Returns `{claimed:false}` for a retry/duplicate so the
 * processor drops it.
 */
export const claimSlackEvent = internalMutation({
  args: { eventId: v.string() },
  returns: v.object({ claimed: v.boolean() }),
  handler: async (ctx, { eventId }) => {
    const existing = await ctx.db
      .query('slackEventDedup')
      .withIndex('by_eventId', (q) => q.eq('eventId', eventId))
      .first();
    if (existing) return { claimed: false };

    await ctx.db.insert('slackEventDedup', {
      eventId,
      expiresAt: Date.now() + DEDUP_TTL_MS,
    });
    await maybeRunSlackDedupCleanup(ctx);
    return { claimed: true };
  },
});

/**
 * A Slack-conversation → thread mapping may be reused only when the underlying
 * Tale thread still exists AND is active. Two non-reusable cases:
 *   - `null` — physically purged (retention Pass B / GDPR erasure).
 *   - soft-deleted (status trashed/expired/deleted) or archived — the row
 *     exists but reusing it would write into a thread the human owner can no
 *     longer see and that retention will later hard-delete.
 * Whitelisting `'active'` keeps any future non-active status safe by default.
 */
export function isReusableThreadMeta(
  meta: { status: string } | null | undefined,
): boolean {
  return meta != null && meta.status === 'active';
}

/**
 * Lookup-or-create the stable Tale thread for a Slack conversation
 * (org + channel + root ts). Owner is the org-scoped external identity
 * `slack:<organizationId>:<slackUserId>` (see identities/external_identities)
 * so the Slack author is preserved in history/attribution rather than collapsed
 * to `'system'`. Race-free under OCC, mirroring `getOrCreateUserThread`.
 */
export const getOrCreateSlackThread = internalMutation({
  args: {
    organizationId: v.string(),
    channel: v.string(),
    conversationTs: v.string(),
    slackUserId: v.string(),
    slackUserName: v.optional(v.string()),
  },
  returns: v.object({ threadId: v.string(), created: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('slackThreads')
      .withIndex('by_conversation', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('channel', args.channel)
          .eq('conversationTs', args.conversationTs),
      )
      .first();
    if (existing) {
      // Reuse the mapped thread only when it is still usable (see
      // isReusableThreadMeta). A purged (null) or soft-deleted/archived thread
      // is a dangling mapping: drop the stale row and re-provision a fresh
      // thread below rather than resurrecting a tombstone.
      const meta = await ctx.db
        .query('threadMetadata')
        .withIndex('by_threadId', (q) => q.eq('threadId', existing.threadId))
        .first();
      if (isReusableThreadMeta(meta)) {
        return { threadId: existing.threadId, created: false };
      }
      await ctx.db.delete(existing._id);
    }

    const ownerId = buildExternalOwnerId(
      'slack',
      args.slackUserId,
      args.organizationId,
    );
    const title = args.slackUserName
      ? `Slack · @${args.slackUserName}`
      : `Slack · ${args.slackUserId}`;

    const threadId = await createChatThread(
      ctx,
      ownerId,
      title,
      'general',
      undefined,
      undefined,
      args.organizationId,
    );

    await ctx.db.insert('slackThreads', {
      organizationId: args.organizationId,
      channel: args.channel,
      conversationTs: args.conversationTs,
      threadId,
      slackUserId: args.slackUserId,
      slackUserName: args.slackUserName,
      createdAt: Date.now(),
    });

    return { threadId, created: true };
  },
});

/**
 * Save the user message + schedule generation for a Slack-originated thread.
 * Thin clone of `startWebhookChat` without the agentWebhooks/org-ownership
 * coupling (the thread was just created/owned by us against this org) and
 * without the `'system'` owner fallback (owner is the Slack author).
 */
export const startSlackChat = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    threadId: v.string(),
    message: v.string(),
    agentConfig: v.any(),
    // Caps the generation deadline to the caller's reply-poll window so a
    // long-running agent can't outlast the poll and strand its answer.
    maxDeadlineMs: v.optional(v.number()),
  },
  returns: v.object({ streamId: v.string() }),
  handler: async (ctx, args) => {
    const result = await startAgentChat({
      ctx,
      agentType: 'integration',
      threadId: args.threadId,
      organizationId: args.organizationId,
      message: args.message,
      agentConfig: args.agentConfig,
      model: args.agentConfig.model ?? 'default',
      provider: args.agentConfig.provider,
      agentSlug: args.agentSlug,
      debugTag: `[slack:${args.agentSlug}]`,
      enableStreaming: false,
      maxDeadlineMs: args.maxDeadlineMs,
    });
    return { streamId: result.streamId };
  },
});
