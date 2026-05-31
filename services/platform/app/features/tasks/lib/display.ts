/**
 * Presentational maps for task status + priority: ordering, i18n key suffixes,
 * and `@tale/ui` Badge variants. Pure constants shared across board/table/detail.
 */

import type { Doc } from '@/convex/_generated/dataModel';

export type TaskStatus = Doc<'tasks'>['status'];
export type TaskPriority = NonNullable<Doc<'tasks'>['priority']>;
/** Polymorphic actor type shared by assignees, comment authors, and activity. */
export type TaskActorType = NonNullable<Doc<'tasks'>['assigneeType']>;

/** Board column order (left → right). */
export const TASK_STATUS_ORDER: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
];

const TASK_STATUS_SET = new Set<string>(TASK_STATUS_ORDER);

/** Type guard: is `value` one of the known task statuses? */
export function isTaskStatus(value: string): value is TaskStatus {
  return TASK_STATUS_SET.has(value);
}

/**
 * Maps a stored activity `action` (see convex/tasks/helpers.ts `recordActivity`)
 * to its `tasks` i18n key. Unknown actions fall back to the raw string at the
 * call site, so the timeline degrades gracefully if a new action ships.
 */
export const TASK_ACTIVITY_LABEL_KEY: Record<string, string> = {
  created: 'activity.created',
  updated: 'activity.updated',
  claimed: 'activity.claimed',
  archived: 'activity.archived',
  restored: 'activity.restored',
  reordered: 'activity.reordered',
  'status.changed': 'activity.statusChanged',
  'assignee.changed': 'activity.assigneeChanged',
  'comment.added': 'activity.commentAdded',
};

type BadgeVariant =
  | 'outline'
  | 'destructive'
  | 'orange'
  | 'yellow'
  | 'blue'
  | 'green';

export const TASK_STATUS_BADGE_VARIANT: Record<TaskStatus, BadgeVariant> = {
  backlog: 'outline',
  todo: 'blue',
  in_progress: 'yellow',
  in_review: 'orange',
  done: 'green',
  cancelled: 'destructive',
};

export const TASK_PRIORITY_ORDER: TaskPriority[] = ['p0', 'p1', 'p2', 'p3'];
