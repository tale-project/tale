import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';

import { jsonValueValidator } from '../../lib/shared/schemas/utils/json-value';
import { api } from '../_generated/api';
import { action } from '../_generated/server';

export const startWorkflow = action({
  args: {
    organizationId: v.string(),
    wfDefinitionId: v.id('wfDefinitions'),
    input: v.optional(jsonValueValidator),
    triggeredBy: v.string(),
    triggerData: v.optional(jsonValueValidator),
  },
  returns: v.id('wfExecutions'),
  handler: async (ctx, args): Promise<Id<'wfExecutions'>> => {
    return await ctx.runMutation(
      api.workflow_engine.mutations.startWorkflow,
      args,
    );
  },
});
