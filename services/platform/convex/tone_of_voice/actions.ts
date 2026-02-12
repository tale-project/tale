'use node';

/**
 * Tone of Voice Actions
 */

import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { api } from '../_generated/api';
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

export const addExampleMessage = action({
  args: {
    organizationId: v.string(),
    content: v.string(),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.id('exampleMessages'),
  handler: async (ctx, args): Promise<Id<'exampleMessages'>> => {
    return await ctx.runMutation(
      api.tone_of_voice.mutations.addExampleMessage,
      args,
    );
  },
});

export const updateExampleMessage = action({
  args: {
    messageId: v.id('exampleMessages'),
    content: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runMutation(
      api.tone_of_voice.mutations.updateExampleMessage,
      args,
    );
    return null;
  },
});

export const deleteExampleMessage = action({
  args: {
    messageId: v.id('exampleMessages'),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.runMutation(
      api.tone_of_voice.mutations.deleteExampleMessage,
      args,
    );
    return null;
  },
});

export const upsertToneOfVoice = action({
  args: {
    organizationId: v.string(),
    generatedTone: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.id('toneOfVoice'),
  handler: async (ctx, args): Promise<Id<'toneOfVoice'>> => {
    return await ctx.runMutation(
      api.tone_of_voice.mutations.upsertToneOfVoice,
      args,
    );
  },
});
