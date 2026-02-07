'use node';

/**
 * Tone of Voice Actions
 */

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { generateToneOfVoice as generateToneOfVoiceHelper } from './generate_tone_of_voice';
import { generateToneResponseValidator } from './validators';

export const generateToneOfVoice = action({
  args: {
    organizationId: v.string(),
  },
  returns: generateToneResponseValidator,
  handler: async (ctx, args) => {
    return await generateToneOfVoiceHelper(ctx, args);
  },
});
