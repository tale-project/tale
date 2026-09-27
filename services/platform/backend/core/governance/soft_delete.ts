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

/**
 * The subset the admin Trash actually lists and restores — every type with
 * a pg trash stop (a lifecycle column the soft delete writes and the
 * restore flips back). The rest of `SOFT_DELETE_RESOURCE_TYPES` is deleted
 * outright, through its own door or by retention, and never answers a
 * Trash row; offering it as a filter category only ever produced an empty
 * list (2026-09-26 evaluation, E-20/G-15). The server's source registry
 * (`backend/domains/governance/trash.ts`) and the Trash page's filter both
 * key off this list, so the two cannot drift.
 */
export const TRASH_LISTED_RESOURCE_TYPES = [
  'chatThread',
  'contact',
  'document',
  'externalConversation',
  'fileMetadata',
  'messageFeedback',
] as const satisfies readonly SoftDeleteResourceType[];

export type TrashListedResourceType =
  (typeof TRASH_LISTED_RESOURCE_TYPES)[number];
