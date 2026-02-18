/**
 * Tone of Voice Queries
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import { getToneOfVoiceWithExamples as getToneOfVoiceWithExamplesHelper } from './get_tone_of_voice_with_examples';
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

const EXAMPLE_MESSAGES_COUNT_CAP = 20;

export const approxCountExampleMessages = query({
  args: {
    organizationId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return 0;
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return 0;
    }

    let count = 0;
    for await (const _ of ctx.db
      .query('exampleMessages')
      .withIndex('by_organizationId', (q) =>
        q.eq('organizationId', args.organizationId),
      )) {
      count++;
      if (count >= EXAMPLE_MESSAGES_COUNT_CAP) break;
    }
    return count;
  },
});
