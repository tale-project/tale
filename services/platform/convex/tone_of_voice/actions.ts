'use node';

/**
 * Tone of Voice Public Actions
 */

import { v } from 'convex/values';
import { action } from '../_generated/server';
import { generateToneOfVoice as generateToneOfVoiceHelper } from './generate_tone_of_voice';

export const generateToneOfVoice = action({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await generateToneOfVoiceHelper(ctx, args);
  },
});
