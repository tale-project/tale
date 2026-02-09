import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getExecution as getExecutionLogic } from '../workflows/executions/get_execution';
import { getRawExecution as getRawExecutionLogic } from '../workflows/executions/get_raw_execution';

export const getExecution = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
  },
  handler: async (ctx, args) => {
    const result = await getExecutionLogic(ctx, args.executionId);
    if (!result) return null;
    return result;
  },
});

export const getRawExecution = internalQuery({
  args: {
    executionId: v.id('wfExecutions'),
  },
  handler: async (ctx, args) => {
    return await getRawExecutionLogic(ctx, args.executionId);
  },
});
