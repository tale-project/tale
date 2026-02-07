'use node';

/**
 * Tone of Voice - Internal Actions
 */

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { generateToneOfVoice } from './generate_tone_of_voice';
import { generateToneResponseValidator } from './validators';

export const generateToneOfVoiceUncached = internalAction({
  args: {
    organizationId: v.string(),
  },
  returns: generateToneResponseValidator,
  handler: async (ctx, args) => {
    return await generateToneOfVoice(ctx, args);
  },
});
