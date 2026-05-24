import { v } from 'convex/values';

import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { resolveLanguageModelWithFallback } from '../providers/failover';
import { improveMessage as improveMessageHandler } from './improve_message';

export const improveMessage = action({
  args: {
    originalMessage: v.string(),
    instruction: v.optional(v.string()),
    organizationId: v.string(),
  },
  returns: v.object({
    improvedMessage: v.string(),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ improvedMessage: string; error?: string }> => {
    await requireOrgMembershipById(ctx, args.organizationId);

    // Resolve fast/chat model from provider files
    const { languageModel, modelData } = await resolveLanguageModelWithFallback(
      ctx,
      {
        tag: 'chat',
        organizationId: args.organizationId,
      },
    );

    return improveMessageHandler(ctx, {
      ...args,
      languageModel,
      modelData,
    });
  },
});
