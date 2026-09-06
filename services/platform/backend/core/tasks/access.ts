/**
 * Task access control.
 *
 * A task has NO ACL of its own — its effective access is its parent project's
 * access (`domains/tasks/service.ts` asserts it through the project access
 * primitives). This module keeps the pure, unit-testable claim rule.
 */

/** Shape of a task as far as claim logic cares (DB-agnostic). */
interface TaskAssignableInput {
  status: string;
  assigneeType?: string | null;
  assigneeId?: string | null;
  archivedAt?: number | null;
}

/**
 * Statuses in which a task may be claimed or (re)assigned. Terminal states
 * (done/cancelled) are excluded — finished work isn't picked up.
 */
export const ASSIGNABLE_STATUSES = new Set([
  'backlog',
  'todo',
  'in_progress',
  'in_review',
]);

/**
 * A task can be claimed iff it has no current assignee, is not archived, and is
 * in an assignable (non-terminal) status. The claim write re-reads and applies
 * this inside its serializable transaction so concurrent claimers serialize —
 * the loser sees the winner's assignee and is rejected.
 */
export function canClaimTask(task: TaskAssignableInput): boolean {
  if (task.archivedAt) return false;
  if (task.assigneeId) return false;
  return ASSIGNABLE_STATUSES.has(task.status);
}
