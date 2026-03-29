'use node';

import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import { action } from '../_generated/server';
import { authComponent } from '../auth';

const DEFAULT_ORG_SLUG = 'default';

export const startWorkflowFromFile = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    input: v.optional(jsonValueValidator),
    triggeredBy: v.string(),
    triggerData: v.optional(jsonValueValidator),
  },
  returns: v.union(v.id('wfExecutions'), v.null()),
  handler: async (ctx, args): Promise<Id<'wfExecutions'> | null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await ctx.runQuery(
      internal.approvals.internal_queries.verifyOrganizationMembership,
      {
        organizationId: args.organizationId,
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name ?? '',
      },
    );

    return await ctx.runAction(
      internal.workflow_engine.helpers.engine.start_workflow_from_file
        .startWorkflowFromFile,
      {
        organizationId: args.organizationId,
        orgSlug: DEFAULT_ORG_SLUG,
        workflowSlug: args.workflowSlug,
        input: args.input,
        triggeredBy: args.triggeredBy,
        triggerData: args.triggerData,
        userId: String(authUser._id),
      },
    );
  },
});
