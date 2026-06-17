'use node';

import { v } from 'convex/values';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import { deserializeVariablesInAction } from '../workflow_engine/helpers/serialization/deserialize_variables';
import type { ExecutionVariablesInspection } from '../workflows/executions/build_variables_inspection';
import { buildVariablesInspection } from '../workflows/executions/build_variables_inspection';

export const startWorkflowFromFile = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    input: v.optional(jsonValueValidator),
    triggeredBy: v.string(),
    triggerData: v.optional(jsonValueValidator),
    debugMode: v.optional(v.boolean()),
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
        debugMode: args.debugMode,
      },
    );
  },
});

/**
 * Per-step I/O inspection for the step-debug panel (#1490). An action (not a
 * query) because variables ≥400KB are offloaded to Convex storage, which only
 * actions can read; outputs are capped server-side before returning.
 */
export const getExecutionVariables = action({
  args: {
    executionId: v.id('wfExecutions'),
  },
  returns: v.object({
    input: v.optional(jsonValueValidator),
    variables: jsonValueValidator,
    steps: jsonValueValidator,
    lastOutput: v.optional(jsonValueValidator),
    lastOutputTruncated: v.optional(v.boolean()),
  }),
  handler: async (ctx, args): Promise<ExecutionVariablesInspection> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const execution = await ctx.runQuery(
      internal.workflow_executions.internal_queries.getRawExecution,
      { executionId: args.executionId },
    );
    if (!execution) {
      throw new Error('Execution not found');
    }

    // Throws when the caller is not a member of the execution's organization.
    await ctx.runQuery(
      internal.approvals.internal_queries.verifyOrganizationMembership,
      {
        organizationId: execution.organizationId,
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      },
    );

    const variables = await deserializeVariablesInAction(
      ctx,
      execution.variables,
    );
    return buildVariablesInspection(variables, execution.input);
  },
});
