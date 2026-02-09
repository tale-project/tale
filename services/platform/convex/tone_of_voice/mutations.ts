import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { addExampleMessage as addExampleMessageHelper } from './add_example_message';
import { deleteExampleMessage as deleteExampleMessageHelper } from './delete_example_message';
import { updateExampleMessage as updateExampleMessageHelper } from './update_example_message';
import { upsertToneOfVoice as upsertToneOfVoiceHelper } from './upsert_tone_of_voice';

export const addExampleMessage = mutation({
  args: {
    organizationId: v.string(),
    content: v.string(),
    metadata: v.optional(jsonRecordValidator),
  },
  returns: v.id('exampleMessages'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
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
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
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
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
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
  returns: v.id('toneOfVoice'),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    return await upsertToneOfVoiceHelper(ctx, args);
  },
});
