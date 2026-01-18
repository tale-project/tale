'use node';

/**
 * Tone of Voice - Internal Actions for Caching
 */

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { generateToneOfVoice } from './generate_tone_of_voice';

export const generateToneOfVoiceUncached = internalAction({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await generateToneOfVoice(ctx, args);
  },
});
