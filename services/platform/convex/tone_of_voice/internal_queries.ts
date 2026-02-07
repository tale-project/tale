import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import { getToneOfVoice as getToneOfVoiceHelper } from './get_tone_of_voice';
import { loadExampleMessagesForGeneration as loadExampleMessagesHelper } from './load_example_messages_for_generation';
import {
  exampleMessageContentValidator,
  toneOfVoiceValidator,
} from './validators';

export const loadExampleMessagesForGeneration = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(exampleMessageContentValidator),
  handler: async (ctx, args) => {
    return await loadExampleMessagesHelper(ctx, args);
  },
});

export const getToneOfVoice = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(toneOfVoiceValidator, v.null()),
  handler: async (ctx, args) => {
    return await getToneOfVoiceHelper(ctx, args);
  },
});
