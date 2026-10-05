/**
 * Audit log action constants for the tasks feature.
 *
 * Every task mutation writes a `createAuditLog` entry in category `'data'` with
 * `resourceType: 'task'` (comments use `'task_comment'`). Centralizing the
 * action strings here keeps grep-ability tight and makes future i18n key
 * generation deterministic — mirrors `projects/audit_actions.ts`.
 */
export const TASK_AUDIT_ACTIONS = {
  created: 'task.created',
  updated: 'task.updated',
  statusChanged: 'task.status_changed',
  externalStatusProjected: 'task.external_status_projected',
  externalStatusRequested: 'task.external_status_requested',
  assigned: 'task.assigned',
  unassigned: 'task.unassigned',
  reviewerChanged: 'task.reviewer_changed',
  commentCreated: 'task.comment.created',
  commentUpdated: 'task.comment.updated',
  commentDeleted: 'task.comment.deleted',
  dependencyAdded: 'task.dependency.added',
  dependencyRemoved: 'task.dependency.removed',
  archived: 'task.archived',
  restored: 'task.restored',
  deleted: 'task.deleted',
} as const;

export const TASK_RESOURCE_TYPE = 'task';
export const TASK_COMMENT_RESOURCE_TYPE = 'task_comment';
