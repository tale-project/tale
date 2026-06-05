'use node';

import { v } from 'convex/values';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';

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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await ctx.runQuery(
      internal.approvals.internal_queries.verifyOrganizationMembership,
      {
        organizationId: args.organizationId,
        userId: authUser.userId,
        // Pass identity email/name through as-is (optional). `?? ''` would
        // disable getOrganizationMember's email-fallback (empty string is falsy).
        email: authUser.email,
        name: authUser.name,
      },
    );

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);

    return await ctx.runAction(
      internal.workflow_engine.helpers.engine.start_workflow_from_file
        .startWorkflowFromFile,
      {
        organizationId: args.organizationId,
        orgSlug,
        workflowSlug: args.workflowSlug,
        input: args.input,
        triggeredBy: args.triggeredBy,
        triggerData: args.triggerData,
        userId: authUser.userId,
      },
    );
  },
});
