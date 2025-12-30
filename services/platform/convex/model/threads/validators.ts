/**
 * Convex validators for threads model
 */

import { v } from 'convex/values';

/**
 * Chat type validator for thread creation
 */
export const chatTypeValidator = v.union(
  v.literal('general'),
  v.literal('workflow_assistant'),
);

/**
 * Message role validator for thread messages
 */
export const messageRoleValidator = v.union(
  v.literal('user'),
  v.literal('assistant'),
);

/**
 * Thread status validator
 */
export const threadStatusValidator = v.union(
  v.literal('active'),
  v.literal('archived'),
);

/**
 * Tool execution status validator
 */
export const toolStatusValidator = v.union(
  v.literal('calling'),
  v.literal('completed'),
  v.null(),
);

/**
 * Thread message validator (single message in a thread)
 * Note: _id is a string because messages come from Agent Component, not native Convex tables
 */
export const threadMessageValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  role: messageRoleValidator,
  content: v.string(),
});

/**
 * Thread messages response validator
 */
export const threadMessagesResponseValidator = v.object({
  messages: v.array(threadMessageValidator),
});

/**
 * Thread list item validator (for listing threads)
 * Note: _id is a string because threads come from Agent Component, not native Convex tables
 */
export const threadListItemValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  title: v.optional(v.string()),
  status: threadStatusValidator,
  userId: v.optional(v.string()),
});

/**
 * Latest tool message validator
 */
export const latestToolMessageValidator = v.object({
  toolNames: v.array(v.string()),
  status: toolStatusValidator,
  timestamp: v.union(v.number(), v.null()),
});
