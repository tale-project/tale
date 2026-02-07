import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import * as SchedulerHelpers from './helpers/scheduler';

const scheduledWorkflowValidator = v.object({
  wfDefinitionId: v.id('wfDefinitions'),
  organizationId: v.string(),
  name: v.string(),
  schedule: v.string(),
  timezone: v.string(),
  scheduleId: v.id('wfSchedules'),
});

export const getScheduledWorkflows = internalQuery({
  args: {},
  returns: v.array(scheduledWorkflowValidator),
  handler: async (ctx) => {
    return await SchedulerHelpers.getScheduledWorkflows(ctx);
  },
});

export const getLastExecutionTime = internalQuery({
  args: { wfDefinitionId: v.id('wfDefinitions') },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args) => {
    return await SchedulerHelpers.getLastExecutionTime(ctx, args);
  },
});

export const getLastExecutionTimes = internalQuery({
  args: { wfDefinitionIds: v.array(v.id('wfDefinitions')) },
  returns: v.record(v.string(), v.union(v.number(), v.null())),
  handler: async (ctx, args) => {
    const result = await SchedulerHelpers.getLastExecutionTimes(ctx, args);
    return Object.fromEntries(result);
  },
});
