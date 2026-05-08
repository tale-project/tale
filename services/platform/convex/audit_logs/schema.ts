import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';
import { jsonRecordValidator } from '../lib/validators/json';

export const AUDIT_LOG_ACTOR_TYPES = [
  'user',
  'system',
  'api',
  'workflow',
] as const;
export const AUDIT_LOG_CATEGORIES = [
  'auth',
  'member',
  'data',
  'integration',
  'workflow',
  'security',
  'admin',
  'ai',
] as const;
export const AUDIT_LOG_STATUSES = ['success', 'failure', 'denied'] as const;

const actorTypeValidator = v.union(
  ...AUDIT_LOG_ACTOR_TYPES.map((t) => v.literal(t)),
);
const categoryValidator = v.union(
  ...AUDIT_LOG_CATEGORIES.map((c) => v.literal(c)),
);
const statusValidator = v.union(...AUDIT_LOG_STATUSES.map((s) => v.literal(s)));

export const auditLogsTable = defineTable({
  organizationId: v.string(),

  actorId: v.string(),
  actorEmail: v.optional(v.string()),
  actorRole: v.optional(v.string()),
  actorType: actorTypeValidator,

  action: v.string(),
  category: categoryValidator,

  resourceType: v.string(),
  resourceId: v.optional(v.string()),
  resourceName: v.optional(v.string()),

  previousState: v.optional(jsonRecordValidator),
  newState: v.optional(jsonRecordValidator),
  changedFields: v.optional(v.array(v.string())),

  sessionId: v.optional(v.string()),
  ipAddress: v.optional(v.string()),
  userAgent: v.optional(v.string()),
  requestId: v.optional(v.string()),

  /**
   * Peppered hash of `actorEmail` (HMAC-SHA256, prefixed `sha256:`).
   * Populated by writers that handle untrusted user input (e.g. login
   * attempts) when `TALE_AUDIT_PEPPER` is configured. Mutually exclusive
   * with the plaintext `actorEmail` column on the same row — keeping
   * them in separate columns avoids overwriting the searchable plaintext
   * one and keeps CSV export / template renderers from leaking the hash
   * into operator-facing surfaces (round-2 v14 H12).
   */
  actorEmailHash: v.optional(v.string()),
  /**
   * Peppered hash of a /24 (v4) or /64 (v6) prefix of `ipAddress`.
   * Same mutually-exclusive contract as `actorEmailHash`.
   */
  actorIpHash: v.optional(v.string()),

  timestamp: v.number(),
  status: statusValidator,
  errorMessage: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),

  integrityHash: v.optional(v.string()),
  previousHash: v.optional(v.string()),
  /**
   * Forward-link to the next row in the per-org chain. Set by
   * `createAuditLog` after it inserts a successor; reading + patching
   * the predecessor row in the same mutation forces concurrent
   * audit-writers to serialize via Convex OCC, so the chain cannot
   * fork (round-2 v05 M1 finding).
   */
  chainSuccessor: v.optional(v.id('auditLogs')),
  /**
   * GDPR Art 17 PII scrub marker. When true, `actorEmail`, `ipAddress`,
   * `userAgent`, `previousState`, `newState`, and `metadata` have been
   * cleared in place because the row's actor (or subject) exercised
   * their right to erasure. The chain `integrityHash` no longer matches
   * the canonical-record recompute on these rows — `verifyIntegrity`
   * reads the corresponding `auditLogCheckpoints` row with
   * `subtype: 'pii_scrub'` to confirm the divergence is bounded and
   * signed by the operator's deploy-time key.
   */
  piiScrubbed: v.optional(v.boolean()),
  piiScrubbedAt: v.optional(v.number()),
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_lifecycleStatus', [
    'organizationId',
    'lifecycleStatus',
  ])
  .index('by_organizationId_and_timestamp', ['organizationId', 'timestamp'])
  .index('by_organizationId_and_category', ['organizationId', 'category'])
  .index('by_organizationId_and_actorId', ['organizationId', 'actorId'])
  .index('by_organizationId_and_resourceType', [
    'organizationId',
    'resourceType',
  ])
  .index('by_org_category_timestamp', [
    'organizationId',
    'category',
    'timestamp',
  ])
  .index('by_org_resourceType_timestamp', [
    'organizationId',
    'resourceType',
    'timestamp',
  ])
  .index('by_resourceType_and_resourceId', ['resourceType', 'resourceId'])
  .index('by_org_resourceType_resourceId', [
    'organizationId',
    'resourceType',
    'resourceId',
  ])
  .index('by_timestamp', ['timestamp']);
