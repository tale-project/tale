import { v } from 'convex/values';

import { internalMutation } from '../../_generated/server';
import { startAgentChat } from '../../lib/agent_chat';
import type { AgentType } from '../../lib/context_management/constants';
import { createChatThread } from '../../threads/create_chat_thread';

/**
 * Narrow the free-form `agentType` string coming from callers to the closed
 * `AgentType` union expected by `startAgentChat`. Unrecognized values fall
 * back to `'custom'` — same runtime budgets as the plain-webhook path.
 */
const KNOWN_AGENT_TYPES = new Set<AgentType>([
  'chat',
  'integration',
  'workflow',
  'crm',
  'custom',
  'file',
  'web',
  'openai_webhook',
]);

function narrowAgentType(value: string | undefined): AgentType {
  if (value === undefined) return 'custom';
  for (const candidate of KNOWN_AGENT_TYPES) {
    if (candidate === value) return candidate;
  }
  return 'custom';
}

export const updateWebhookLastTriggered = internalMutation({
  args: {
    webhookId: v.id('agentWebhooks'),
    lastTriggeredAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.webhookId, {
      lastTriggeredAt: args.lastTriggeredAt,
    });
    return null;
  },
});

/**
 * Atomic lookup-or-create for the (webhookId, userHash) → threadId mapping.
 *
 * Convex mutations are transactional per-document under OCC with automatic
 * retry on conflict, so doing the query + (optional) insert inside a single
 * mutation body is race-free. A concurrent caller with the same key will
 * either see our row or be retried by the runtime.
 *
 * Used by the OpenAI-compat webhook path when the client supplies a stable
 * `user` field — repeated calls with the same `user` land in the same agent
 * conversation thread.
 */
export const getOrCreateUserThread = internalMutation({
  args: {
    webhookId: v.id('agentWebhooks'),
    organizationId: v.string(),
    userHash: v.string(),
    /**
     * Thread owner ID. When this is the webhook creator's Better Auth user
     * ID, the created thread shows up in that user's chat history — which is
     * what we want for Meetily-style one-webhook-per-user flows. Falls back
     * to `webhook:<id>` for legacy webhooks without a recorded creator.
     */
    chatOwnerId: v.string(),
  },
  returns: v.object({
    threadId: v.string(),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('agentWebhookUserThreads')
      .withIndex('by_webhookId_userHash', (q) =>
        q.eq('webhookId', args.webhookId).eq('userHash', args.userHash),
      )
      .first();

    if (existing) {
      return { threadId: existing.threadId, created: false };
    }

    const threadId = await createChatThread(
      ctx,
      args.chatOwnerId,
      undefined,
      'general',
      undefined,
      undefined,
      args.organizationId,
    );

    await ctx.db.insert('agentWebhookUserThreads', {
      webhookId: args.webhookId,
      organizationId: args.organizationId,
      userHash: args.userHash,
      threadId,
      createdAt: Date.now(),
    });

    return { threadId, created: true };
  },
});

export const startWebhookChat = internalMutation({
  args: {
    agentSlug: v.string(),
    organizationId: v.string(),
    webhookId: v.id('agentWebhooks'),
    message: v.string(),
    threadId: v.optional(v.string()),
    enableStreaming: v.optional(v.boolean()),
    attachments: v.optional(
      v.array(
        v.object({
          fileId: v.id('_storage'),
          fileName: v.string(),
          fileType: v.string(),
          fileSize: v.number(),
        }),
      ),
    ),
    agentConfig: v.any(),
    /**
     * Agent-type tag for audit / telemetry. Plain webhook body uses `'custom'`
     * (default); the OpenAI-compat sub-path passes `'openai_webhook'` so
     * forensics can distinguish the two wire formats without breaking per-agent
     * analytics (which already key on `agentSlug`).
     */
    agentType: v.optional(v.string()),
    /**
     * Thread owner when creating a fresh thread. Prefer the webhook
     * creator's Better Auth user ID so the thread surfaces in that user's
     * chat history. Falls back to `webhook:<id>` when not provided.
     */
    chatOwnerId: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    streamId: v.string(),
  }),
  handler: async (ctx, args) => {
    const userId = args.chatOwnerId ?? `webhook:${args.webhookId}`;

    let threadId: string;
    const incomingThreadId = args.threadId;
    if (incomingThreadId) {
      // Cross-org enforcement: a caller holding a valid webhook token for
      // org A must not be able to post into a thread that belongs to org B,
      // even if they happen to know (or guess) its threadId. The underlying
      // agent-chat pipeline resolves threadMetadata by threadId alone, so
      // we enforce the org boundary here, before any generation runs.
      const threadMeta = await ctx.db
        .query('threadMetadata')
        .withIndex('by_threadId', (q) => q.eq('threadId', incomingThreadId))
        .first();

      if (!threadMeta) {
        throw new Error(`Thread not found: ${incomingThreadId}`);
      }
      if (threadMeta.organizationId !== args.organizationId) {
        throw new Error(
          "Thread does not belong to this webhook's organization",
        );
      }
      threadId = incomingThreadId;
    } else {
      threadId = await createChatThread(
        ctx,
        userId,
        undefined,
        'general',
        undefined,
        undefined,
        args.organizationId,
      );
    }

    const result = await startAgentChat({
      ctx,
      agentType: narrowAgentType(args.agentType),
      threadId,
      organizationId: args.organizationId,
      message: args.message,
      attachments: args.attachments,
      agentConfig: args.agentConfig,
      model: args.agentConfig.model ?? 'default',
      provider: args.agentConfig.provider,
      agentSlug: args.agentSlug,
      debugTag: `[${args.agentSlug}:webhook]`,
      enableStreaming: args.enableStreaming ?? true,
    });

    return { threadId, streamId: result.streamId };
  },
});

/**
 * Delete all `agentWebhookUserThreads` rows whose `webhookId` matches.
 * Called from `deleteWebhook` as a cascade; safe to call on webhooks with no
 * mapping rows (simply returns with zero deletions).
 */
export const deleteUserThreadsByWebhook = internalMutation({
  args: { webhookId: v.id('agentWebhooks') },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('agentWebhookUserThreads')
      .withIndex('by_webhookId_userHash', (q) =>
        q.eq('webhookId', args.webhookId),
      )
      .collect();

    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return null;
  },
});
