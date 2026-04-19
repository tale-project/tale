import { v } from 'convex/values';

import { internalAction } from '../../_generated/server';
import { resolveOrgSlug } from '../../organizations/resolve_org_slug';
import { resolveLanguageModelWithFallback } from '../../providers/failover';
import { autoSummarizeIfNeededModel } from './auto_summarize';

export const autoSummarizeIfNeeded = internalAction({
  args: {
    threadId: v.string(),
    organizationId: v.optional(v.string()),
  },
  returns: v.object({
    summarized: v.boolean(),
    existingSummary: v.optional(v.string()),
    newMessageCount: v.number(),
    totalMessagesSummarized: v.number(),
  }),
  handler: async (ctx, args) => {
    // Resolve chat model from the owning org's providers when available.
    const orgSlug = args.organizationId
      ? await resolveOrgSlug(ctx, args.organizationId)
      : undefined;
    const { languageModel } = await resolveLanguageModelWithFallback(ctx, {
      tag: 'chat',
      orgSlug,
    });

    return await autoSummarizeIfNeededModel(ctx, {
      threadId: args.threadId,
      languageModel,
    });
  },
});
