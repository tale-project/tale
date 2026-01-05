/**
 * Message Metadata - Mutations and Queries
 *
 * Handles storing and retrieving message metadata (tokens, model info, reasoning).
 */

import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

/**
 * Save metadata for a message after generation
 * This should be called by the frontend after receiving the chat response
 */
export const saveMessageMetadata = mutation({
  args: {
    messageId: v.string(),
    threadId: v.string(),
    model: v.string(),
    provider: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
    cachedInputTokens: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    providerMetadata: v.optional(v.any()),
    durationMs: v.optional(v.number()),
    subAgentUsage: v.optional(v.array(v.object({
      toolName: v.string(),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      totalTokens: v.optional(v.number()),
    }))),
  },
  returns: v.id('messageMetadata'),
  handler: async (ctx, args) => {
    // Check if metadata already exists for this message
    const existingMetadata = await ctx.db
      .query('messageMetadata')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .first();

    if (existingMetadata) {
      // Update existing metadata
      await ctx.db.patch(existingMetadata._id, {
        model: args.model,
        provider: args.provider,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        totalTokens: args.totalTokens,
        reasoningTokens: args.reasoningTokens,
        cachedInputTokens: args.cachedInputTokens,
        reasoning: args.reasoning,
        providerMetadata: args.providerMetadata,
        durationMs: args.durationMs,
        subAgentUsage: args.subAgentUsage,
      });
      return existingMetadata._id;
    }

    // Create new metadata entry
    const metadataId = await ctx.db.insert('messageMetadata', {
      messageId: args.messageId,
      threadId: args.threadId,
      model: args.model,
      provider: args.provider,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens: args.totalTokens,
      reasoningTokens: args.reasoningTokens,
      cachedInputTokens: args.cachedInputTokens,
      reasoning: args.reasoning,
      providerMetadata: args.providerMetadata,
      durationMs: args.durationMs,
      subAgentUsage: args.subAgentUsage,
    });

    return metadataId;
  },
});

/**
 * Get metadata for a specific message
 */
export const getMessageMetadata = query({
  args: {
    messageId: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.id('messageMetadata'),
      _creationTime: v.number(),
      model: v.string(),
      provider: v.string(),
      inputTokens: v.optional(v.number()),
      outputTokens: v.optional(v.number()),
      totalTokens: v.optional(v.number()),
      reasoningTokens: v.optional(v.number()),
      cachedInputTokens: v.optional(v.number()),
      reasoning: v.optional(v.string()),
      providerMetadata: v.optional(v.any()),
      durationMs: v.optional(v.number()),
      subAgentUsage: v.optional(v.array(v.object({
        toolName: v.string(),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        totalTokens: v.optional(v.number()),
      }))),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const metadata = await ctx.db
      .query('messageMetadata')
      .withIndex('by_messageId', (q) => q.eq('messageId', args.messageId))
      .first();

    if (!metadata) {
      return null;
    }

    return {
      _id: metadata._id,
      _creationTime: metadata._creationTime,
      model: metadata.model,
      provider: metadata.provider,
      inputTokens: metadata.inputTokens,
      outputTokens: metadata.outputTokens,
      totalTokens: metadata.totalTokens,
      reasoningTokens: metadata.reasoningTokens,
      cachedInputTokens: metadata.cachedInputTokens,
      reasoning: metadata.reasoning,
      providerMetadata: metadata.providerMetadata,
      durationMs: metadata.durationMs,
      subAgentUsage: metadata.subAgentUsage,
    };
  },
});
