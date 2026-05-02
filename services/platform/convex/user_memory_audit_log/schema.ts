import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Append-only audit log for personalization data lifecycle events. Distinct
 * from the platform `auditLogs` table because:
 *  - subject identity is HMAC-pseudonymised (`subjectUserIdHmac`), not raw
 *    `userId`, so org admins reading this table cannot identify who a row
 *    belongs to (admin-blind contract). The HMAC pepper lives in the
 *    `PERSONALIZATION_AUDIT_PEPPER` env var; rotating the pepper effectively
 *    crypto-shreds the linkability for old rows.
 *  - schema is closed: no free-form `metadata: jsonRecord`. Every action's
 *    payload shape is enumerated in this validator so future PRs can't
 *    accidentally smuggle memory content into the log.
 *
 * `actorUserId` is the principal who performed the action (== subject for
 * self-actions, distinct for system / future admin paths). Stored raw because
 * actors are not the protected subject.
 *
 * Action semantics:
 *  - 'propose'    : agent called propose_memory; row written with status=pending
 *  - 'create'     : user added a memory directly in settings (status=approved)
 *  - 'approve'    : user approved a pending proposal
 *  - 'dismiss'    : user dismissed a pending proposal (row hard-deleted)
 *  - 'update'     : user edited the content of an approved memory
 *  - 'invalidate' : user marked an approved memory as no-longer-true
 *  - 'delete'     : user soft-deleted (deletedAt set)
 *  - 'inject'     : memories were folded into a chat turn's system prompt
 *                   (one row per chat turn, with injectedMemoryIds[])
 */
export const userMemoryAuditLogTable = defineTable({
  organizationId: v.string(),
  actorUserId: v.string(),
  subjectUserIdHmac: v.string(),
  action: v.union(
    v.literal('propose'),
    v.literal('create'),
    v.literal('approve'),
    v.literal('dismiss'),
    v.literal('update'),
    v.literal('invalidate'),
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
})
  .index('by_org_subjecthmac_at', [
    'organizationId',
    'subjectUserIdHmac',
    'createdAt',
  ])
  .index('by_org_at', ['organizationId', 'createdAt']);
