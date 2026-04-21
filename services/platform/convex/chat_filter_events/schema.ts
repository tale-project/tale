import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Sidecar telemetry table for guardrails filter outcomes.
 *
 * Separate from `auditLogs` because:
 * 1. `auditLogs.createAuditLog` reads the last row per write (hash chain).
 *    Writing 6+ rows per chat message under load causes OCC contention.
 * 2. `retention_policy.auditLogRetentionDays` applies globally; flag/mask
 *    telemetry retention should be independent (and usually shorter).
 * 3. Dashboards need per-filter / per-direction slicing which a flat
 *    `action` string on audit_logs doesn't index efficiently.
 *
 * `auditLogs` still receives the high-signal `*.blocked_in_chat` entries
 * via `logDenied` — this table is strictly for the detection-frequency
 * signal admins tune against, never the security source of truth.
 *
 * Invariant: NEVER store raw matched text or user-visible message
 * content here. Only `categoryIds`, counts, and derived flags.
 */

export const chatFilterEventsTable = defineTable({
  organizationId: v.string(),
  sanitizationRunId: v.string(),
  threadId: v.string(),
  messageId: v.optional(v.string()),
  filterName: v.union(
    v.literal('pii'),
    v.literal('chat_filter'),
    v.literal('moderation_provider'),
  ),
  direction: v.union(v.literal('input'), v.literal('output')),
  kind: v.union(
    v.literal('detected'),
    v.literal('blocked'),
    v.literal('step_error'),
    v.literal('circuit_open'),
  ),
  categoryIds: v.array(v.string()),
  matchCount: v.optional(v.number()),
  truncated: v.optional(v.boolean()),
  // step_error / circuit_open telemetry (never body/header content)
  errorClass: v.optional(
    v.union(
      v.literal('timeout'),
      v.literal('network'),
      v.literal('parse'),
      v.literal('http_4xx'),
      v.literal('http_5xx'),
      v.literal('config'),
      v.literal('unknown'),
    ),
  ),
  httpStatus: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  attempt: v.optional(v.number()),
  agentSlug: v.optional(v.string()),
  actorType: v.optional(
    v.union(
      v.literal('user'),
      v.literal('api'),
      v.literal('assistant'),
      v.literal('system'),
    ),
  ),
  createdAt: v.number(),
})
  .index('by_org_sanitizationRunId', ['organizationId', 'sanitizationRunId'])
  .index('by_org_createdAt', ['organizationId', 'createdAt'])
  .index('by_org_filter_createdAt', [
    'organizationId',
    'filterName',
    'createdAt',
  ])
  .index('by_org_threadId_createdAt', [
    'organizationId',
    'threadId',
    'createdAt',
  ])
  .index('by_org_kind_createdAt', ['organizationId', 'kind', 'createdAt']);
