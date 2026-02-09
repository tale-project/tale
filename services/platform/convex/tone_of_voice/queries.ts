/**
 * Tone of Voice Queries
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import { getToneOfVoiceWithExamples as getToneOfVoiceWithExamplesHelper } from './get_tone_of_voice_with_examples';
import { hasExampleMessages as hasExampleMessagesHelper } from './has_example_messages';
import { toneOfVoiceWithExamplesValidator } from './validators';

export const getToneOfVoiceWithExamples = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(toneOfVoiceWithExamplesValidator, v.null()),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return null;
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
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
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return false;
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return false;
    }

    return await hasExampleMessagesHelper(ctx, args);
  },
});
