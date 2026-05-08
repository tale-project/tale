import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';

/**
 * Append-only audit log for personalization data lifecycle events. Distinct
 * from the platform `auditLogs` table because schema is closed: no free-form
 * `metadata: jsonRecord`. Every action's payload shape is enumerated in this
 * validator so future PRs can't accidentally smuggle memory content into the
 * log.
 *
 * `subjectUserId` is the user the row pertains to. `actorUserId` is the
 * principal who performed the action (== subject for self-actions). Both are
 * stored raw — admin-blind pseudonymisation can be reintroduced when an
 * admin-readable audit view ships.
 *
 * Action semantics:
 *  - 'propose' : agent called propose_memory; row written with status=pending
 *  - 'create'  : user added a memory directly in settings (status=approved)
 *  - 'approve' : user approved a pending proposal
 *  - 'dismiss' : user dismissed a pending proposal
 *  - 'delete'  : user soft-deleted (deletedAt set)
 *  - 'inject'  : memories were folded into a chat turn's system prompt (one
 *                row per chat turn, with injectedMemoryIds[])
 */
export const userMemoryAuditLogTable = defineTable({
  organizationId: v.string(),
  actorUserId: v.string(),
  subjectUserId: v.string(),
  action: v.union(
    v.literal('propose'),
    v.literal('create'),
    v.literal('approve'),
    v.literal('dismiss'),
    v.literal('delete'),
    v.literal('inject'),
  ),
  outcome: v.union(v.literal('ok'), v.literal('denied'), v.literal('error')),
  memoryId: v.optional(v.id('userMemories')),
  injectedMemoryIds: v.optional(v.array(v.id('userMemories'))),
  threadId: v.optional(v.string()),
  messageId: v.optional(v.string()),
  agentSlug: v.optional(v.string()),
  requestId: v.optional(v.string()),
  createdAt: v.number(),
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
})
  .index('by_org_subject_at', ['organizationId', 'subjectUserId', 'createdAt'])
  .index('by_org_at', ['organizationId', 'createdAt'])
  .index('by_org_lifecycleStatus', ['organizationId', 'lifecycleStatus']);
