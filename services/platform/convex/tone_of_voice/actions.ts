'use node';

/**
 * Tone of Voice Actions
 */

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { authComponent } from '../auth';
import { generateToneOfVoice as generateToneOfVoiceHelper } from './generate_tone_of_voice';
import { generateToneResponseValidator } from './validators';

export const generateToneOfVoice = action({
  args: {
    organizationId: v.string(),
  },
  returns: generateToneResponseValidator,
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    return await generateToneOfVoiceHelper(ctx, args);
  },
});
