import { type TaskStatus, TASK_TERMINAL_STATUSES } from './display';

export interface DependencyEdge {
  blockerTaskId: string;
  blockedTaskId: string;
}

/**
 * Set of task ids that are currently blocked: a task is blocked when at least
 * one of its blockers is present in the set and still in a non-terminal status.
 * A blocker that is missing from the visible set (archived/deleted) or already
 * done/cancelled no longer blocks — the dependency is treated as resolved.
 *
 * Inputs are intentionally narrow (just the fields read) so the board's task
 * rows and dependency edges both satisfy them without coupling to the full doc.
 */
export function computeBlockedTaskIds(
  tasks: readonly { _id: string; status: TaskStatus }[],
  edges: readonly { blockerTaskId: string; blockedTaskId: string }[],
): Set<string> {
  const statusById = new Map<string, TaskStatus>();
  for (const task of tasks) statusById.set(task._id, task.status);

  const blocked = new Set<string>();
  for (const edge of edges) {
    const blockerStatus = statusById.get(edge.blockerTaskId);
    if (blockerStatus && !TASK_TERMINAL_STATUSES.has(blockerStatus)) {
      blocked.add(edge.blockedTaskId);
    }
  }
  return blocked;
}
