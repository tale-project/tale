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
  agentSlug: v.optional(v.string()),
  /** @deprecated Use agentSlug. Retained for backward compatibility with existing documents. */
  agentId: v.optional(v.id('agentBindings')),
  /** @deprecated Retained for backward compatibility with existing documents. */
  customAgentId: v.optional(v.id('customAgents')),
  // Sharing fields
  shareToken: v.optional(v.string()),
  sharedAt: v.optional(v.number()),
  sharedBy: v.optional(v.string()),
  isShared: v.optional(v.boolean()),
  forkedFrom: v.optional(v.string()),
  // Arena mode fields
  arenaGroupId: v.optional(v.string()),
  arenaModelId: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
  isBranch: v.optional(v.boolean()),
})
  .index('by_threadId', ['threadId'])
  .index('by_userId_chatType_status', [
    'userId',
    'chatType',
    'status',
    'createdAt',
  ])
  .index('by_userId_chatType_status_updated', [
    'userId',
    'chatType',
    'status',
    'updatedAt',
  ])
  .index('by_shareToken', ['shareToken'])
  .index('by_arenaGroupId', ['arenaGroupId']);
