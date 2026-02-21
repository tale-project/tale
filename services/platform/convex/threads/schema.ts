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
})
  .index('by_threadId', ['threadId'])
  .index('by_userId_chatType_status', [
    'userId',
    'chatType',
    'status',
    'createdAt',
  ]);
