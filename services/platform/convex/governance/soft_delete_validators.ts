import { v } from 'convex/values';

/**
 * Soft-delete lifecycle states. Mirrors the existing `threadStatusValidator`
 * shape (active/trashed/expired/deleted) so retention's two-pass
 * grace-window machinery is uniform across tables.
 *
 * For tables that already use `status` for a business concern (customers,
 * conversations, audit logs), this is stored under `lifecycleStatus`
 * instead of `status`. `threadMetadata` is the single legacy exception:
 * its `status` field shipped before this generalisation and continues to
 * serve as the lifecycle status. The trash registry knows which tables
 * use which field name.
 */
export const SOFT_DELETE_STATUSES = [
  'active',
  'trashed',
  'expired',
  'deleted',
] as const;

export type SoftDeleteStatus = (typeof SOFT_DELETE_STATUSES)[number];

export const lifecycleStatusValidator = v.union(
  v.literal('active'),
  v.literal('trashed'),
  v.literal('expired'),
  v.literal('deleted'),
);

/**
 * Resource types that participate in the soft-delete + grace + restore
 * lifecycle. The Trash UI lists rows by these keys, the generic restore
 * mutation dispatches on these keys, and the per-table registry maps
 * each to its physical table + lifecycle field name.
 *
 * Deployment-wide telemetry tables (loginAttempts, loginBlockCounters,
 * twoFactorAttempts) are NOT included here — they have no
 * `organizationId` column and so can't be filtered in an org-scoped
 * trash list. They retain hard-delete behaviour in the cleanup sweep.
 */
export const SOFT_DELETE_RESOURCE_TYPES = [
  'thread',
  'document',
  'fileMetadata',
  // User-initiated `deletePrompt` is hard-delete (no recovery). Retention-
  // driven cleanup goes through the soft-delete + Trash flow so admins
  // can recover before the grace-period purge.
  'promptTemplate',
  'messageFeedback',
  'customer',
  'vendor',
  'externalConversation',
  // Round-2 V2 P1-A/B: `messageMetadata` and `workflowTriggerLog` were
  // listed here but their schema-side state never matched (former had
  // no organizationId/lifecycleStatus, latter mapped to the wrong
  // table). Both already had bespoke retention paths
  // (`deleteExpiredMessageMetadata` / `deleteExpiredWorkflowTriggerLog`)
  // that didn't go through the generic Trash flow. Dropped.
  'workflowExecution',
  'usageLedger',
  'auditLog',
  'chatFilterEvent',
  'memoryAudit',
] as const;

export type SoftDeleteResourceType =
  (typeof SOFT_DELETE_RESOURCE_TYPES)[number];

export const softDeleteResourceTypeValidator = v.union(
  ...SOFT_DELETE_RESOURCE_TYPES.map((t) => v.literal(t)),
);
