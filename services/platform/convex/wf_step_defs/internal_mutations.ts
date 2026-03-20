import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import { updateStep as updateStepHelper } from '../workflows/steps/update_step';

export const patchStep = internalMutation({
  args: {
    stepRecordId: v.id('wfStepDefs'),
    updates: jsonRecordValidator,
  },
  handler: async (ctx, args) => {
    return await updateStepHelper(ctx, args);
  },
});

export const batchPatchSteps = internalMutation({
  args: {
    stepPatches: v.array(
      v.object({
        stepRecordId: v.id('wfStepDefs'),
        updates: jsonRecordValidator,
      }),
    ),
  },
  handler: async (ctx, args) => {
    const results = await Promise.all(
      args.stepPatches.map((patch) => updateStepHelper(ctx, patch)),
    );
    return results;
  },
});
