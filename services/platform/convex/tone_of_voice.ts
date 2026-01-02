/**
 * Tone of Voice API - Thin wrappers around model functions
 */

import { v } from 'convex/values';
import {
  internalMutation,
  internalQuery,
  internalAction,
  action,
} from './_generated/server';
import { internal } from './_generated/api';
import { queryWithRLS, mutationWithRLS } from './lib/rls';
import * as ToneOfVoiceModel from './model/tone_of_voice';
import type { GenerateToneResponse } from './model/tone_of_voice/types';
import { toneOfVoiceCache } from './lib/action_cache';

// ==================== QUERIES ====================

/**
 * Get tone of voice for an organization
 */
export const getToneOfVoice = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(v.null(), ToneOfVoiceModel.toneOfVoiceValidator),
  handler: async (ctx, args) => {
    return await ToneOfVoiceModel.getToneOfVoice(ctx, args);
  },
});

/**
 * Get tone of voice with example messages
 */
export const getToneOfVoiceWithExamples = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(v.null(), ToneOfVoiceModel.toneOfVoiceWithExamplesValidator),
  handler: async (ctx, args) => {
    return await ToneOfVoiceModel.getToneOfVoiceWithExamples(ctx, args);
  },
});

/**
 * Check if any example messages exist for an organization (for two-phase loading)
 */
export const hasExampleMessages = queryWithRLS({
  args: {
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await ToneOfVoiceModel.hasExampleMessages(ctx, args);
  },
});

// ==================== MUTATIONS ====================

/**
 * Create or update tone of voice
 */
export const upsertToneOfVoice = mutationWithRLS({
  args: {
    organizationId: v.string(),
    generatedTone: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.id('toneOfVoice'),
  handler: async (ctx, args) => {
    return await ToneOfVoiceModel.upsertToneOfVoice(ctx, args);
  },
});

/**
 * Add an example message
 */
export const addExampleMessage = mutationWithRLS({
  args: {
    organizationId: v.string(),
    content: v.string(),
    metadata: v.optional(v.any()),
  },
  returns: v.id('exampleMessages'),
  handler: async (ctx, args) => {
    return await ToneOfVoiceModel.addExampleMessage(ctx, args);
  },
});

/**
 * Update an example message
 */
export const updateExampleMessage = mutationWithRLS({
  args: {
    messageId: v.id('exampleMessages'),
    content: v.optional(v.string()),
    metadata: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await ToneOfVoiceModel.updateExampleMessage(ctx, args);
  },
});

/**
 * Delete an example message
 */
export const deleteExampleMessage = mutationWithRLS({
  args: {
    messageId: v.id('exampleMessages'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await ToneOfVoiceModel.deleteExampleMessage(ctx, args);
  },
});

// ==================== INTERNAL QUERIES ====================

/**
 * Internal query to get tone of voice (bypasses RLS)
 */
export const getToneOfVoiceInternal = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.union(v.null(), ToneOfVoiceModel.toneOfVoiceValidator),
  handler: async (ctx, args) => {
    return await ToneOfVoiceModel.getToneOfVoice(ctx, args);
  },
});

/**
 * Internal query to load example messages for AI processing
 */
export const loadExampleMessagesForGeneration = internalQuery({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(ToneOfVoiceModel.exampleMessageContentValidator),
  handler: async (ctx, args) => {
    return await ToneOfVoiceModel.loadExampleMessagesForGeneration(ctx, args);
  },
});

// ==================== INTERNAL MUTATIONS ====================

/**
 * Internal mutation to save generated tone
 */
export const saveGeneratedTone = internalMutation({
  args: {
    organizationId: v.string(),
    generatedTone: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await ToneOfVoiceModel.saveGeneratedTone(ctx, args);
  },
});

// ==================== ACTIONS ====================

/**
 * Generate tone of voice from example messages using AI.
 * Results are cached for 24 hours to avoid repeated AI calls.
 */
export const generateToneOfVoice = action({
  args: {
    organizationId: v.string(),
    forceRefresh: v.optional(v.boolean()),
  },
  returns: ToneOfVoiceModel.generateToneResponseValidator,
  handler: async (ctx, args): Promise<GenerateToneResponse> => {
    if (args.forceRefresh) {
      return await ToneOfVoiceModel.generateToneOfVoice(ctx, args);
    }
    return (await toneOfVoiceCache.fetch(ctx, {
      organizationId: args.organizationId,
    })) as GenerateToneResponse;
  },
});

/**
 * Internal action for tone of voice generation (uncached).
 * Used by the ActionCache.
 */
export const generateToneOfVoiceUncached = internalAction({
  args: {
    organizationId: v.string(),
  },
  returns: ToneOfVoiceModel.generateToneResponseValidator,
  handler: async (ctx, args) => {
    return await ToneOfVoiceModel.generateToneOfVoice(ctx, args);
  },
});

/**
 * Internal action to invalidate tone of voice cache for an organization.
 */
export const invalidateToneCache = internalAction({
  args: {
    organizationId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, _args) => {
    await toneOfVoiceCache.removeAllForName(ctx);
    return null;
  },
});
