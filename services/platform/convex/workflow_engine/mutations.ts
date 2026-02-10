import { v } from 'convex/values';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { workflowManagers } from './engine';
import { handleStartWorkflow } from './helpers/engine/start_workflow_handler';

export const startWorkflow = mutation({
  args: {
    organizationId: v.string(),
    wfDefinitionId: v.id('wfDefinitions'),
    input: v.optional(jsonValueValidator),
    triggeredBy: v.string(),
    triggerData: v.optional(jsonValueValidator),
  },
  returns: v.id('wfExecutions'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    return await handleStartWorkflow(ctx, args, workflowManagers);
  },
});
