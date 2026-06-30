'use node';

import { ConvexError, v } from 'convex/values';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { api, internal } from '../_generated/api';
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
    // Generic domain resource this run is "about" (e.g. {type:'task', id}). Lets
    // any UI component show its run inline by querying executions for its
    // (subjectType, subjectId) — no per-component schema field.
    subject: v.optional(v.object({ type: v.string(), id: v.string() })),
    debugMode: v.optional(v.boolean()),
  },
  returns: v.union(v.id('wfExecutions'), v.null()),
  handler: async (ctx, args): Promise<Id<'wfExecutions'> | null> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
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
        subject: args.subject,
        userId: authUser.userId,
        debugMode: args.debugMode,
      },
    );
  },
});

/**
 * Re-run an existing workflow execution as a fresh run — the "re-run" affordance
 * on a terminal (failed/completed/cancelled) run. A failed run is terminal and
 * cannot be resumed; instead we start a clean new run by copying the original's
 * stored input/triggerData/subject, so it re-enters at the start node. The new
 * run carries the SAME subject, so any UI showing the resource's run (via
 * getLatestExecutionForSubject) switches to it.
 *
 * Guarded against duplicate concurrent runs over the subject's shared resource
 * (e.g. a task's `tale/<taskId>` git branch + PR): while a run for the subject
 * is still pending/running, refuses and returns the in-flight executionId.
 */
export const rerunExecution = action({
  args: {
    executionId: v.id('wfExecutions'),
  },
  returns: v.object({
    started: v.boolean(),
    executionId: v.union(v.string(), v.null()),
    reason: v.optional(
      v.union(v.literal('already_running'), v.literal('not_started')),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    started: boolean;
    executionId: string | null;
    reason?: 'already_running' | 'not_started';
  }> => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const execution = await ctx.runQuery(
      internal.workflow_executions.internal_queries.getRawExecution,
      { executionId: args.executionId },
    );
    if (!execution) {
      throw new ConvexError({ code: 'EXECUTION_NOT_FOUND' });
    }

    // Closes the cross-tenant IDOR: confirm the caller belongs to the
    // execution's org before reading/copying any of its data downstream.
    await ctx.runQuery(
      internal.approvals.internal_queries.verifyOrganizationMembership,
      {
        organizationId: execution.organizationId,
        userId: authUser.userId,
        email: authUser.email,
        name: authUser.name,
      },
    );

    if (!execution.workflowSlug) {
      throw new ConvexError({ code: 'EXECUTION_MISSING_SLUG' });
    }

    const subject =
      execution.subjectType !== undefined && execution.subjectId !== undefined
        ? { type: execution.subjectType, id: execution.subjectId }
        : undefined;

    if (subject) {
      const active = await ctx.runQuery(
        internal.workflow_executions.internal_queries
          .getActiveExecutionForSubject,
        {
          organizationId: execution.organizationId,
          subjectType: subject.type,
          subjectId: subject.id,
        },
      );
      if (active) {
        return {
          started: false,
          reason: 'already_running',
          executionId: active.executionId,
        };
      }
    }

    const newExecutionId = await ctx.runAction(
      api.workflow_executions.actions.startWorkflowFromFile,
      {
        organizationId: execution.organizationId,
        workflowSlug: execution.workflowSlug,
        triggeredBy: 'user',
        input: execution.input,
        triggerData: execution.triggerData,
        subject,
      },
    );
    if (!newExecutionId) {
      return { started: false, reason: 'not_started', executionId: null };
    }
    return { started: true, executionId: newExecutionId };
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
      throw new ConvexError({ code: 'UNAUTHENTICATED' });
    }

    const execution = await ctx.runQuery(
      internal.workflow_executions.internal_queries.getRawExecution,
      { executionId: args.executionId },
    );
    if (!execution) {
      throw new ConvexError({ code: 'EXECUTION_NOT_FOUND' });
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
