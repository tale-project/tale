/**
 * Public mutations for creating draft from active workflow
 */

import { v } from 'convex/values';
import { mutationWithRLS } from '../../lib/rls';
import { createDraftFromActive } from '../../workflows/definitions/create_draft_from_active';

export const createDraftFromActivePublic = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    createdBy: v.string(),
  },
  handler: async (ctx, args) => {
    return await createDraftFromActive(ctx, args);
  },
});
