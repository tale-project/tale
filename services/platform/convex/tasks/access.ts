/**
 * Task access control.
 *
 * A task has NO ACL of its own — its effective access is its parent project's
 * access. This module re-exports the project access primitives and adds pure,
 * unit-testable helpers for the task-specific assignee/claim semantics.
 */

export {
  checkProjectAccess,
  getProjectTeamIds,
  hasProjectAccess,
  isAgentAllowedByProject,
  isOrgWideProject,
  type ProjectAccessResult,
} from '../projects/access';

import { ConvexError, type Infer } from 'convex/values';

import type { taskAssigneeTypeValidator } from './schema';

type TaskActorType = Infer<typeof taskAssigneeTypeValidator>;

/** Shape of a task as far as claim/assign logic cares (DB-agnostic). */
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
 * in an assignable (non-terminal) status. The atomic claim mutation re-reads
 * and applies this under Convex single-transaction OCC so concurrent claimers
 * serialize — the loser sees the winner's assignee and is rejected.
 */
export function canClaimTask(task: TaskAssignableInput): boolean {
  if (task.archivedAt) return false;
  if (task.assigneeId) return false;
  return ASSIGNABLE_STATUSES.has(task.status);
}

/**
 * Validate a polymorphic assignee pair. Returns the normalized pair (both set)
 * or `null` to mean "unassigned" (both cleared). Throws on a half-set pair.
 */
export function normalizeAssignee(input: {
  assigneeType?: TaskActorType | null;
  assigneeId?: string | null;
}): { assigneeType: TaskActorType; assigneeId: string } | null {
  const { assigneeType, assigneeId } = input;
  const hasType = assigneeType != null;
  const hasId = assigneeId != null && assigneeId !== '';
  if (!hasType && !hasId) return null;
  // Half-set pair, or (defensively) a value that didn't narrow — both must be
  // present together. The explicit null checks let TS narrow without a cast.
  if (assigneeType == null || assigneeId == null || assigneeId === '') {
    throw new ConvexError({
      code: 'task_assignee_invalid',
      message: 'assigneeType and assigneeId must be set or cleared together',
    });
  }
  return { assigneeType, assigneeId };
}

/** True when `actor` is the task's current assignee (self-action check). */
export function isSelfAssignment(
  task: TaskAssignableInput,
  actorType: TaskActorType,
  actorId: string,
): boolean {
  return task.assigneeType === actorType && task.assigneeId === actorId;
}
