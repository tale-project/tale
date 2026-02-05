/**
 * Tone of Voice Queries
 */

import { v } from 'convex/values';
import { query, internalQuery } from '../_generated/server';
import { getToneOfVoiceWithExamples as getToneOfVoiceWithExamplesHelper } from './get_tone_of_voice_with_examples';
import { getToneOfVoice as getToneOfVoiceHelper } from './get_tone_of_voice';
import { hasExampleMessages as hasExampleMessagesHelper } from './has_example_messages';
import { loadExampleMessagesForGeneration as loadExampleMessagesHelper } from './load_example_messages_for_generation';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

export const getToneOfVoiceWithExamples = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return null;
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return null;
    }

    return await getToneOfVoiceWithExamplesHelper(ctx, args);
  },
});

export const hasExampleMessages = query({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return false;
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return false;
    }

    return await hasExampleMessagesHelper(ctx, args);
  },
});

export const loadExampleMessagesForGeneration = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await loadExampleMessagesHelper(ctx, args);
  },
});

export const getToneOfVoiceInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  handler: async (ctx, args) => {
    return await getToneOfVoiceHelper(ctx, args);
  },
});
