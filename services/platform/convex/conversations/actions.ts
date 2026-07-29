import { v } from 'convex/values';

import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import { improveMessage as improveMessageHandler } from './improve_message';

// Model resolution (`resolveLanguageModelWithFallback` from
// the moved `convex/providers/failover`) dropped — `improveMessageHandler`
// is offline and no longer needs a resolved model. See `improve_message.ts`.

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
    return improveMessageHandler(ctx, args);
  },
});
