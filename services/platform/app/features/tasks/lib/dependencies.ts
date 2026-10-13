import { type TaskStatus, TASK_TERMINAL_STATUSES } from './display';

export interface DependencyEdge {
  blockerTaskId: string;
  blockedTaskId: string;
  blockerResolved?: boolean;
}

/**
 * Set of task ids that are currently blocked, using server-resolved edges so
 * board visibility never resolves a live blocker. Older servers without that
 * stamp fall back to the supplied task/status set.
 *
 * Inputs are intentionally narrow (just the fields read) so the board's task
 * rows and dependency edges both satisfy them without coupling to the full doc.
 */
export function computeBlockedTaskIds(
  tasks: readonly { _id: string; status: TaskStatus }[],
  edges: readonly DependencyEdge[],
): Set<string> {
  const statusById = new Map<string, TaskStatus>();
  for (const task of tasks) statusById.set(task._id, task.status);

  const blocked = new Set<string>();
  for (const edge of edges) {
    const blockerStatus = statusById.get(edge.blockerTaskId);
    const resolved =
      edge.blockerResolved ??
      (!blockerStatus || TASK_TERMINAL_STATUSES.has(blockerStatus));
    if (!resolved) {
      blocked.add(edge.blockedTaskId);
    }
  }
  return blocked;
}
