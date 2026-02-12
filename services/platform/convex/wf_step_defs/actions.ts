import { v } from 'convex/values';

import { api } from '../_generated/api';
import { action } from '../_generated/server';
import { stepConfigValidator } from '../workflow_engine/types/nodes';
import {
  editModeValidator,
  stepTypeValidator,
} from '../workflows/steps/validators';

export const createStep = action({
  args: {
    wfDefinitionId: v.id('wfDefinitions'),
    stepSlug: v.string(),
    name: v.string(),
    stepType: stepTypeValidator,
    order: v.number(),
    config: stepConfigValidator,
    nextSteps: v.record(v.string(), v.string()),
    editMode: editModeValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(api.wf_step_defs.mutations.createStep, args);
  },
});
