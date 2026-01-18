/**
 * Public query for getting workflow steps
 */

import { v } from 'convex/values';
import { queryWithRLS } from '../lib/rls';
import { listWorkflowSteps as listWorkflowStepsHelper } from '../workflows/steps/list_workflow_steps';

export const getWorkflowStepsPublic = queryWithRLS({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
  },
  handler: async (ctx, args) => {
    return await listWorkflowStepsHelper(ctx, args);
  },
});
