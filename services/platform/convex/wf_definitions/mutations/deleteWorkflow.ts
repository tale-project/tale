/**
 * Public mutations for deleting workflows
 */

import { v } from 'convex/values';
import { mutationWithRLS } from '../../lib/rls';
import { deleteWorkflow } from '../../workflows/definitions/delete_workflow';

export const deleteWorkflowPublic = mutationWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
  },
  handler: async (ctx, args) => {
    return await deleteWorkflow(ctx, args.wfDefinitionId);
  },
});
