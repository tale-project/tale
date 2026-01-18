/**
 * Public mutations for duplicating workflows
 */

import { v } from 'convex/values';
import { mutationWithRLS } from '../../lib/rls';
import { duplicateWorkflow } from '../../workflows/definitions/duplicate_workflow';

export const duplicateWorkflowPublic = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    newName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await duplicateWorkflow(ctx, args);
  },
});
