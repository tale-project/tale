import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { saveGeneratedTone as saveGeneratedToneHelper } from './save_generated_tone';

export const saveGeneratedTone = internalMutation({
  args: {
    organizationId: v.string(),
    generatedTone: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await saveGeneratedToneHelper(ctx, args);
  },
});
