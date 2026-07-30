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
  'connector',
  // Legacy spelling of `connector` from before the integration→connector
  // rename (#2876). 0.4 deploys never write it; accepted so pre-rename LOCAL
  // dev rows keep validating (audit rows are immutable history — a hash
  // chain — so they are read as-is rather than rewritten).
  'integration',
  'workflow',
  'security',
  'admin',
  'ai',
  'skill',
  'agent',
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
  // Dedup lookups that target a single actor (e.g. recordOrgSwitch's
  // "did THIS user already sign in to THIS org recently?") — lets the query
  // range on timestamp for one actor instead of scanning every actor's rows
  // in the org+category+time window.
  .index('by_org_category_actorId_timestamp', [
    'organizationId',
    'category',
    'actorId',
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

/**
 * Per-org chain-genesis sentinel.
 *
 * `createAuditLog`'s OCC anti-fork mechanism patches the prior row's
 * `chainSuccessor` to force concurrent writers to conflict on a real
 * document. That mechanism breaks for the very first audit row of an
 * org — `lastEntry` is null, the patch is skipped, and two concurrent
 * first-writers can both insert with `previousHash: ''`, permanently
 * forking the chain.
 *
 * This sentinel exists so every `createAuditLog` call has a guaranteed
 * write target. Each writer reads + patches `lastInsertedAt` in the
 * same transaction; concurrent first-writers contend on this single
 * row and serialize via OCC. The row is upserted lazily on first audit
 * insert per org.
 *
 * Read by `audit_logs/helpers.ts:createAuditLog`.
 */
export const auditLogChainGenesisTable = defineTable({
  organizationId: v.string(),
  lastInsertedAt: v.number(),
}).index('by_organizationId', ['organizationId']);

/**
 * Per-org progress cursor for the scheduled integrity check (#1505, #1846).
 *
 * The daily cron can only verify a bounded number of rows per org per run
 * (`MAX_ENTRIES_PER_ORG`) and a bounded number of orgs per run
 * (`MAX_ORGS_PER_RUN`). Without persisted progress the cron re-walked the
 * oldest window every run, so the NEWEST rows — where live tampering would
 * land — and every org beyond the first window were never checked (#1846
 * items 1 + 2). This row stores how far each org's chain has been verified so
 * the cron pages forward across runs, and `updatedAt` drives round-robin org
 * selection so every org is reached even past `MAX_ORGS_PER_RUN`.
 *
 * Read + written by `audit_logs/integrity_check.ts`.
 */
export const auditIntegrityProgressTable = defineTable({
  organizationId: v.string(),
  /** Timestamp of the last verified row — resume lower bound (`fromTimestamp`). */
  lastVerifiedTimestamp: v.optional(v.number()),
  /** `_id` of the last verified row — exact resume cursor (`afterId`). */
  lastVerifiedId: v.optional(v.string()),
  /** `integrityHash` of the last verified row — seeds the next page's linkage. */
  previousExpectedHash: v.optional(v.string()),
  /**
   * True when the last run reached the live chain head (no truncation). Still
   * revisited on later runs to verify newly-appended rows.
   */
  headReached: v.boolean(),
  /**
   * When this org's cursor was last advanced. Round-robin selection verifies
   * the stalest orgs first so a deployment with more than `MAX_ORGS_PER_RUN`
   * audited orgs still covers all of them across runs.
   */
  updatedAt: v.number(),
  /**
   * Fingerprint of the integrity incident this org was last ALERTED about
   * (#1845). The cron writes an in-band audit row on every failing run, but
   * only fires the out-of-band notification when the fingerprint of the current
   * break differs from this — so the SAME unresolved break isn't re-alerted
   * daily. Cleared when a run verifies cleanly, so a later re-break re-alerts.
   * Absent means no active alert.
   */
  lastAlertedFingerprint: v.optional(v.string()),
  /** When the last out-of-band integrity alert fired (paired with the above). */
  lastAlertedAt: v.optional(v.number()),
}).index('by_organizationId', ['organizationId']);
