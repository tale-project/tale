/**
 * Tone of Voice Mutations
 */

import { v } from 'convex/values';
import { mutation, internalMutation } from '../_generated/server';
import { addExampleMessage as addExampleMessageHelper } from './add_example_message';
import { updateExampleMessage as updateExampleMessageHelper } from './update_example_message';
import { deleteExampleMessage as deleteExampleMessageHelper } from './delete_example_message';
import { upsertToneOfVoice as upsertToneOfVoiceHelper } from './upsert_tone_of_voice';
import { saveGeneratedTone as saveGeneratedToneHelper } from './save_generated_tone';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const addExampleMessage = mutation({
  args: {
    organizationId: v.string(),
    content: v.string(),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    return await addExampleMessageHelper(ctx, args);
  },
});

export const updateExampleMessage = mutation({
  args: {
    messageId: v.id('exampleMessages'),
    content: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error('Example message not found');
    }

    await getOrganizationMember(ctx, message.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    return await updateExampleMessageHelper(ctx, args);
  },
});

export const deleteExampleMessage = mutation({
  args: {
    messageId: v.id('exampleMessages'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    const message = await ctx.db.get(args.messageId);
    if (!message) {
      throw new Error('Example message not found');
    }

    await getOrganizationMember(ctx, message.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    return await deleteExampleMessageHelper(ctx, args);
  },
});

export const upsertToneOfVoice = mutation({
  args: {
    organizationId: v.string(),
    generatedTone: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser.userId ?? '',
      email: authUser.email,
      name: authUser.name,
    });

    return await upsertToneOfVoiceHelper(ctx, args);
  },
});

export const saveGeneratedTone = internalMutation({
  args: {
    organizationId: v.string(),
    generatedTone: v.string(),
  },
  handler: async (ctx, args) => {
    return await saveGeneratedToneHelper(ctx, args);
  },
});
