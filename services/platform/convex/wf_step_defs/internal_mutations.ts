import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { updateStep as updateStepHelper } from '../workflows/steps/update_step';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const patchStep = internalMutation({
  args: {
    stepRecordId: v.id('wfStepDefs'),
    updates: jsonRecordValidator,
  },
  handler: async (ctx, args) => {
    return await updateStepHelper(ctx, args);
  },
});
