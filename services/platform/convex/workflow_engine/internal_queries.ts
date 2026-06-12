import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { jsonRecordValidator } from '../lib/validators/json';
import * as SchedulerHelpers from './helpers/scheduler';

const scheduledWorkflowValidator = v.object({
  workflowSlug: v.string(),
  organizationId: v.string(),
  name: v.string(),
  schedule: v.string(),
  timezone: v.string(),
  scheduleId: v.id('wfSchedules'),
  variables: v.optional(jsonRecordValidator),
});

export const getScheduledWorkflows = internalQuery({
  args: {},
  returns: v.array(scheduledWorkflowValidator),
  handler: async (ctx) => {
    return await SchedulerHelpers.getScheduledWorkflows(ctx);
  },
});

const orgWorkflowKeyValidator = v.object({
  organizationId: v.string(),
  workflowSlug: v.string(),
});

export const getLastExecutionTime = internalQuery({
  args: orgWorkflowKeyValidator,
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    return await SchedulerHelpers.getLastExecutionTimeForOrg(ctx, args);
  },
});

// Batch variants return records keyed by `${organizationId}::${workflowSlug}`
// (SchedulerHelpers.orgWorkflowKey) — slugs alone repeat across orgs.
export const getLastExecutionTimes = internalQuery({
  args: { keys: v.array(orgWorkflowKeyValidator) },
  returns: v.record(v.string(), v.union(v.number(), v.null())),
  handler: async (ctx, args) => {
    const result = await SchedulerHelpers.getLastExecutionTimesForOrgs(
      ctx,
      args,
    );
    return Object.fromEntries(result);
  },
});

export const getRunningExecutions = internalQuery({
  args: { keys: v.array(orgWorkflowKeyValidator) },
  returns: v.record(v.string(), v.boolean()),
  handler: async (ctx, args) => {
    const result = await SchedulerHelpers.hasRunningExecutionsForOrgs(
      ctx,
      args,
    );
    return Object.fromEntries(result);
  },
});
