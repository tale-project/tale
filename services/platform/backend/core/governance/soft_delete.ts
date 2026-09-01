/**
 * Soft-delete lifecycle states. Mirrors the thread-status
 * shape (active/trashed/expired/deleted) so retention's two-pass
 * grace-window machinery is uniform across tables.
 *
 * For tables that already use `status` for a business concern
 * (conversations, audit logs), this is stored under `lifecycleStatus`
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
  'chatThread',
  'document',
  'fileMetadata',
  'messageFeedback',
  'contact',
  'externalConversation',
  'workflowExecution',
  'usageLedger',
  'automationRun',
  'auditLog',
  'chatFilterEvent',
] as const;

export type SoftDeleteResourceType =
  (typeof SOFT_DELETE_RESOURCE_TYPES)[number];
