/**
 * Convex validators for thread operations
 */

import { v } from 'convex/values';

export const chatTypeValidator = v.union(
  v.literal('general'),
  v.literal('workflow_assistant'),
  v.literal('agent_test'),
);

export const messageRoleValidator = v.union(
  v.literal('user'),
  v.literal('assistant'),
);

export const threadStatusValidator = v.union(
  v.literal('active'),
  v.literal('archived'),
);

export const toolStatusValidator = v.union(
  v.literal('calling'),
  v.literal('completed'),
  v.null(),
);

export const threadMessageValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  role: messageRoleValidator,
  content: v.string(),
});

export const threadListItemValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  title: v.optional(v.string()),
  status: threadStatusValidator,
  userId: v.optional(v.string()),
});

export const latestToolMessageValidator = v.object({
  toolNames: v.array(v.string()),
  status: toolStatusValidator,
  timestamp: v.union(v.number(), v.null()),
});

export const getOrCreateSubThreadResultValidator = v.object({
  threadId: v.string(),
  isNew: v.boolean(),
});
