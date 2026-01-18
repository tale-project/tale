/**
 * Public mutations for publishing workflow drafts
 */

import { v } from 'convex/values';
import { mutationWithRLS } from '../../lib/rls';
import { publishDraft } from '../../workflows/definitions/publish_draft';

export const publishDraftPublic = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    publishedBy: v.string(),
    changeLog: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await publishDraft(ctx, args);
  },
});
