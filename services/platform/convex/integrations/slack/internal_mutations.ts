import { v } from 'convex/values';

import type { MutationCtx } from '../../_generated/server';
import { internalMutation } from '../../_generated/server';
import { buildExternalOwnerId } from '../../identities/external_identities';
import { startAgentChat } from '../../lib/agent_chat';
import { rateLimiter } from '../../lib/rate_limiter';
import { createChatThread } from '../../threads/create_chat_thread';

// Slack retries deliveries for a few minutes; a 1h TTL is generously past that.
const DEDUP_TTL_MS = 60 * 60 * 1000;
// Bounded per-sweep delete count so the gated cleanup stays a quick mutation.
const DEDUP_GC_PER_SWEEP = 1000;

/**
 * Opportunistic, rate-limiter-gated GC of expired dedup rows. Runs at most once
 * per hour deployment-wide (token bucket, capacity 1). Best-effort: a missing
 * limiter component (e.g. a test ctx) skips the sweep rather than crashing the
 * claim. No cron — mirrors `cleanup:sandbox` / `cleanup:tts`.
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
}

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

    const now = Date.now();
    await ctx.db.insert('slackEventDedup', {
      eventId,
      createdAt: now,
      expiresAt: now + DEDUP_TTL_MS,
    });
    await maybeRunSlackDedupCleanup(ctx);
    return { claimed: true };
  },
});

/**
 * Lookup-or-create the stable Tale thread for a Slack conversation
 * (org + channel + root ts). Owner is the namespaced external identity
 * `slack:<slackUserId>` (see identities/external_identities) so the Slack
 * author is preserved in history/attribution rather than collapsed to
 * `'system'`. Race-free under OCC, mirroring `getOrCreateUserThread`.
 */
export const getOrCreateSlackThread = internalMutation({
  args: {
    organizationId: v.string(),
    channel: v.string(),
    conversationTs: v.string(),
    agentSlug: v.optional(v.string()),
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
    if (existing) return { threadId: existing.threadId, created: false };

    const ownerId = buildExternalOwnerId('slack', args.slackUserId);
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
      agentSlug: args.agentSlug,
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
    });
    return { streamId: result.streamId };
  },
});
