import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Per-user, per-org cross-thread memory entries. Each row is one short fact
 * the assistant should recall ("user prefers Go", "timezone is PT").
 *
 * `status` is a small state machine:
 *  - 'pending'     : agent proposed via `propose_memory`; user has not yet
 *                    confirmed. Never injected into a system prompt. Hard-
 *                    deleted by lazy cleanup once `pendingExpiresAt` passes.
 *  - 'approved'    : the live state — user authored manually, or approved a
 *                    pending proposal. Eligible for injection.
 *  - 'invalidated' : the fact is no longer believed (superseded by another
 *                    memory or marked stale by the user). Kept for audit and
 *                    inspector visibility, never injected. Distinct from
 *                    `deletedAt` (= "user no longer wants this row at all").
 *
 * `source` records who authored the row: a manual addition in settings, an
 * agent's proposal, or (v2) an automatic extraction.
 *
 * `supersedesId` (optional) links a new memory to the row it replaces, giving
 * the inspector UI a "what does the assistant believe now" trail. Cheap
 * additive field; no index needed at v1 scale.
 *
 * `pendingExpiresAt` is set only on pending rows (24h TTL).
 * `deletedAt` is the user-driven soft-delete timestamp; lazy cleanup hard-
 * deletes the row 30d after this timestamp.
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
  status: v.union(
    v.literal('pending'),
    v.literal('approved'),
    v.literal('invalidated'),
  ),
  supersedesId: v.optional(v.id('userMemories')),
  sourceThreadId: v.optional(v.string()),
  sourceMessageId: v.optional(v.string()),
  language: v.optional(v.string()),
  createdAt: v.number(),
  lastUsedAt: v.optional(v.number()),
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
  .index('by_pendingExpiresAt', ['pendingExpiresAt']);
