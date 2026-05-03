import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Per-user, per-org cross-thread memory entries. Each row is one short fact
 * the assistant should recall ("user prefers Go", "timezone is PT").
 *
 * `status` is a two-state machine:
 *  - 'pending'  : agent proposed via `propose_memory`; user has not yet
 *                 confirmed. Never injected into a system prompt.
 *                 Soft-deleted by lazy cleanup once `pendingExpiresAt`
 *                 passes (24h TTL).
 *  - 'approved' : the live state — user authored manually, or approved a
 *                 pending proposal. Eligible for injection.
 *
 * `source` records who authored the row.
 *
 * `pendingExpiresAt` is set only on pending rows (24h TTL).
 * `deletedAt` is the soft-delete timestamp; lazy cleanup hard-deletes the
 * row 30d after this timestamp. User-initiated dismiss/delete sets it.
 *
 * The composite index supports the two read paths:
 *   - injection : (userId, organizationId, status='approved', deletedAt=undefined) ordered by createdAt
 *   - settings  : (userId, organizationId, [any status], [any deletedAt]) ordered by createdAt
 * Both use the same index by leaving status / deletedAt unconstrained when
 * needed.
 */
export const userMemoriesTable = defineTable({
  userId: v.string(),
  organizationId: v.string(),
  content: v.string(),
  source: v.union(v.literal('manual'), v.literal('agent_proposed')),
  status: v.union(v.literal('pending'), v.literal('approved')),
  sourceThreadId: v.optional(v.string()),
  sourceMessageId: v.optional(v.string()),
  createdAt: v.number(),
  pendingExpiresAt: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
})
  .index('by_user_org_status_deleted_created', [
    'userId',
    'organizationId',
    'status',
    'deletedAt',
    'createdAt',
  ])
  .index('by_organizationId', ['organizationId'])
  .index('by_pendingExpiresAt', ['pendingExpiresAt']);
