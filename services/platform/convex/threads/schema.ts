import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { chatTypeValidator, threadStatusValidator } from './validators';

export const threadMetadataTable = defineTable({
  threadId: v.string(),
  userId: v.string(),
  chatType: chatTypeValidator,
  status: threadStatusValidator,
  /**
   * Timestamp of the last `status` transition. Required for the retention
   * grace-window math: a `trashed`/`expired` row hard-deletes when
   * `now - statusChangedAt > graceDays`. `optional` for backward-compat
   * with rows written before this field was introduced; treat missing as
   * "no grace timer started" (cleanup falls back to `_creationTime`).
   */
  statusChangedAt: v.optional(v.number()),
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
  organizationId: v.optional(v.string()),
  // Sharing fields
  shareToken: v.optional(v.string()),
  sharedAt: v.optional(v.number()),
  sharedBy: v.optional(v.string()),
  isShared: v.optional(v.boolean()),
  forkedFrom: v.optional(v.string()),
  forkedFromShare: v.optional(v.boolean()),
  forkedMessageCount: v.optional(v.number()),
  lastForkedMessageOrder: v.optional(v.number()),
  forkedAt: v.optional(v.number()),
  // Arena mode fields
  arenaGroupId: v.optional(v.string()),
  arenaModelId: v.optional(v.string()),
  updatedAt: v.optional(v.number()),
  isBranch: v.optional(v.boolean()),
  branchSelections: v.optional(v.string()),
  // Team/workspace assignment
  teamId: v.optional(v.string()),
  // Personalization opt-out at the thread level. When true, this thread
  // skips both reads (no user memory injected into system prompt) and
  // writes (the propose_memory tool is stripped from the agent). Used by
  // future "Temporary chat" UI; v1 only the schema field is in.
  disablePersonalization: v.optional(v.boolean()),
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
  .index('by_arenaGroupId', ['arenaGroupId'])
  .index('by_organizationId', ['organizationId']);
