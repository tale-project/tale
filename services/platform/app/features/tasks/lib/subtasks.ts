import type { TaskDoc } from './display';

type TaskRow = TaskDoc;

export interface PartitionedTasks {
  /** Tasks rendered as top-level rows: roots, plus any orphan whose parent is
   *  not in the visible set (so a child never silently disappears). */
  topLevel: TaskRow[];
  /** parentTaskId → its visible children, sorted by board rank. */
  childrenByParent: Map<string, TaskRow[]>;
}

/**
 * Split a flat task list into top-level rows and a parent→children map so the
 * table/list views can render subtasks nested inside their parent instead of as
 * independent rows. A child whose parent is missing from the set (e.g. archived)
 * falls back to top-level so it stays reachable.
 */
export function partitionSubtasks(tasks: TaskRow[]): PartitionedTasks {
  const present = new Set(tasks.map((t) => t._id));
  const childrenByParent = new Map<string, TaskRow[]>();
  const topLevel: TaskRow[] = [];

  for (const task of tasks) {
    const parentId = task.parentTaskId;
    if (parentId && present.has(parentId)) {
      const siblings = childrenByParent.get(parentId);
      if (siblings) siblings.push(task);
      else childrenByParent.set(parentId, [task]);
    } else {
      topLevel.push(task);
    }
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => a.rank.localeCompare(b.rank));
  }

  return { topLevel, childrenByParent };
}

/** Completed-vs-total subtask counts for a parent's progress ring. */
export function subtaskProgress(children: TaskRow[] | undefined): {
  done: number;
  total: number;
} {
  if (!children || children.length === 0) return { done: 0, total: 0 };
  const done = children.filter((c) => c.status === 'done').length;
  return { done, total: children.length };
}
