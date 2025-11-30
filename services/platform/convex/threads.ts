/**
 * Thread Management Functions
 *
 * Consolidated thread-related functions for managing chat threads
 * using the Convex Agent Component.
 */

import { query, mutation } from './_generated/server';
import { v } from 'convex/values';
import { validateOrganizationAccess, getAuthenticatedUser } from './lib/rls';
import * as ThreadsModel from './model/threads';

/**
 * Create a new chat thread using Convex Agent Component.
 * Simply wraps createThread and validates organization access.
 */
export const createChatThread = mutation({
  args: {
    organizationId: v.string(),
    title: v.optional(v.string()),
    chatType: v.optional(
      v.union(v.literal('general'), v.literal('workflow_assistant')),
    ),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    // Validate user has access to the organization
    const rlsContext = await validateOrganizationAccess(
      ctx,
      args.organizationId,
    );

    return await ThreadsModel.createChatThread(
      ctx,
      rlsContext.user.userId,
      args.title,
      args.chatType ?? 'general',
    );
  },
});

/**
 * Delete (archive) a chat thread using Convex Agent Component.
 * Sets status to "archived" to allow recovery if needed.
 */
export const deleteChatThread = mutation({
  args: {
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Validate user is authenticated
    const user = await getAuthenticatedUser(ctx);
    if (!user) {
      throw new Error('Not authenticated');
    }

    await ThreadsModel.deleteChatThread(ctx, args.threadId);
    return null;
  },
});

/**
 * Get messages for a thread using Agent Component's listMessages.
 * This returns messages formatted for UI display.
 * Uses excludeToolMessages: true to filter out tool messages and paginates
 * through ALL messages to support threads with more than 100 messages.
 */
export const getThreadMessages = query({
  args: {
    threadId: v.string(),
  },
  returns: v.object({
    messages: v.array(
      v.object({
        _id: v.string(),
        _creationTime: v.number(),
        role: v.union(v.literal('user'), v.literal('assistant')),
        content: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    return await ThreadsModel.getThreadMessages(ctx, args.threadId);
  },
});

/**
 * List all active threads for the authenticated user.
 */
export const listThreads = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.string(),
      _creationTime: v.number(),
      title: v.optional(v.string()),
      status: v.union(v.literal('active'), v.literal('archived')),
      userId: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) return [];

    return await ThreadsModel.listThreads(ctx, user.userId);
  },
});

/**
 * Update a chat thread's title using Convex Agent Component.
 */
export const updateChatThread = mutation({
  args: {
    threadId: v.string(),
    title: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Validate user is authenticated
    const user = await getAuthenticatedUser(ctx);
    if (!user) {
      throw new Error('Not authenticated');
    }

    await ThreadsModel.updateChatThread(ctx, args.threadId, args.title);
    return null;
  },
});

/**
 * Get the active runId for a thread (if any).
 * This is used to recover the chat polling state after a page refresh.
 * The runId is stored in the thread's summary field as JSON: { chatType, activeRunId }.
 */
export const getActiveRunId = query({
  args: {
    threadId: v.string(),
  },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    return await ThreadsModel.getActiveRunId(ctx, args.threadId);
  },
});

/**
 * Clear the active runId from a thread's summary.
 * Called when chat generation fails or is canceled.
 */
export const clearActiveRunId = mutation({
  args: {
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ThreadsModel.clearActiveRunId(ctx, args.threadId);
    return null;
  },
});
