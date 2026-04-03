import { v } from 'convex/values';

import { isRecord, getString } from '../../../lib/utils/type-guards';
import { components, internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';

export const chatViaWebhook = internalAction({
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
  },
  returns: v.object({
    threadId: v.string(),
    streamId: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ threadId: string; streamId: string }> => {
    const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'organization',
      where: [{ field: '_id', value: args.organizationId, operator: 'eq' }],
    });

    const orgRecord = isRecord(org) ? org : undefined;
    const orgSlug = orgRecord ? getString(orgRecord, 'slug') : undefined;
    if (!orgSlug) {
      throw new Error('Organization not found');
    }

    const agentConfig = await ctx.runAction(
      internal.agents.file_actions.resolveAgentConfig,
      {
        orgSlug,
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
      },
    );

    return ctx.runMutation(
      internal.agents.webhooks.internal_mutations.startWebhookChat,
      {
        agentSlug: args.agentSlug,
        organizationId: args.organizationId,
        webhookId: args.webhookId,
        message: args.message,
        threadId: args.threadId,
        enableStreaming: args.enableStreaming,
        attachments: args.attachments,
        agentConfig,
      },
    );
  },
});
