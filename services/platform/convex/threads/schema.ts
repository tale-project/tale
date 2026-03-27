import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { chatTypeValidator, threadStatusValidator } from './validators';

export const threadMetadataTable = defineTable({
  threadId: v.string(),
  userId: v.string(),
  chatType: chatTypeValidator,
  status: threadStatusValidator,
  title: v.optional(v.string()),
  createdAt: v.number(),
  generationStatus: v.optional(
    v.union(v.literal('generating'), v.literal('idle')),
  ),
  streamId: v.optional(v.string()),
  cancelledAt: v.optional(v.number()),
  cancelledMessageId: v.optional(v.string()),
  generationStartTime: v.optional(v.number()),
  customAgentId: v.optional(v.id('customAgents')),
})
  .index('by_threadId', ['threadId'])
  .index('by_userId_chatType_status', [
    'userId',
    'chatType',
    'status',
    'createdAt',
  ]);
