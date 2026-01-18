/**
 * Mutations for publishing workflow drafts
 */

import { v } from 'convex/values';
import { internalMutation } from '../../_generated/server';
import { mutationWithRLS } from '../../lib/rls';
import { publishDraft as publishDraftLogic } from '../../workflows/definitions/publish_draft';

export const publishDraftPublic = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    publishedBy: v.string(),
    changeLog: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await publishDraftLogic(ctx, args);
  },
});

export const publishDraft = internalMutation({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    publishedBy: v.string(),
    changeLog: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await publishDraftLogic(ctx, args);
  },
});
