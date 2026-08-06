import type { TaskRow } from '../components/task-card';
import type { TaskPriority } from './display';

export const ALL_ASSIGNEE_FILTER = '__all__';
export const ASSIGNEE_FILTER_ME = '__me__';
export const ASSIGNEE_FILTER_UNASSIGNED = '__unassigned__';
export const ALL_PRIORITY_FILTER = '__all__';

export type TaskAssigneeFilter =
  | typeof ALL_ASSIGNEE_FILTER
  | typeof ASSIGNEE_FILTER_ME
  | typeof ASSIGNEE_FILTER_UNASSIGNED
  // `string & {}` keeps the sentinel literals visible (a plain `| string`
  // collapses the union to `string`) while still accepting any assignee id.
  | (string & {});

export type TaskPriorityFilter =
  | typeof ALL_PRIORITY_FILTER
  | TaskPriority
  | 'none';

/** Maps the assignee facet to a server `assigneeId` arg when the query can narrow. */
export function resolveAssigneeQueryFilter(
  filter: TaskAssigneeFilter,
  currentUserId?: string,
): string | undefined {
  if (filter === ALL_ASSIGNEE_FILTER || filter === ASSIGNEE_FILTER_UNASSIGNED) {
    return undefined;
  }
  if (filter === ASSIGNEE_FILTER_ME) {
    return currentUserId;
  }
  return filter;
}

/**
 * Whether a task waits on THIS user's review: the pending review approval
 * names them (`requestedFor`), or the task sits at `in_review` with them as
 * the designated reviewer — the field term keeps the facet live for parks
 * that predate the settle mint (and workflow-lane parks that never mint).
 * No current user → matches nobody (mirrors ASSIGNEE_FILTER_ME's no-op).
 */
export function taskAwaitsMyReview(
  task: Pick<TaskRow, 'status' | 'reviewerUserId'>,
  args: {
    currentUserId?: string;
    /** `requestedFor` of the task's pending review approval, when one exists. */
    pendingReviewRequestedFor?: string;
  },
): boolean {
  if (!args.currentUserId) return false;
  if (args.pendingReviewRequestedFor === args.currentUserId) return true;
  return (
    task.status === 'in_review' && task.reviewerUserId === args.currentUserId
  );
}

export function filterTasksByFacets(
  tasks: TaskRow[],
  filters: {
    assignee: TaskAssigneeFilter;
    priority: TaskPriorityFilter;
    currentUserId?: string;
    /** Keep only tasks waiting on the current user's review. */
    needsMyReview?: boolean;
    /** taskId → `requestedFor` of its pending review approval. */
    reviewRequestedFor?: ReadonlyMap<string, string | undefined>;
  },
): TaskRow[] {
  return tasks.filter((task) => {
    if (filters.assignee === ASSIGNEE_FILTER_UNASSIGNED) {
      if (task.assigneeId) return false;
    } else if (filters.assignee === ASSIGNEE_FILTER_ME) {
      // No current user → "me" matches nobody; treat as a no-op rather than
      // silently collapsing to "unassigned" (task.assigneeId === undefined).
      if (filters.currentUserId && task.assigneeId !== filters.currentUserId) {
        return false;
      }
    } else if (filters.assignee !== ALL_ASSIGNEE_FILTER) {
      if (task.assigneeId !== filters.assignee) return false;
    }

    if (
      filters.needsMyReview &&
      !taskAwaitsMyReview(task, {
        currentUserId: filters.currentUserId,
        pendingReviewRequestedFor: filters.reviewRequestedFor?.get(task._id),
      })
    ) {
      return false;
    }

    if (filters.priority === ALL_PRIORITY_FILTER) return true;
    if (filters.priority === 'none') return !task.priority;
    return task.priority === filters.priority;
  });
}
