/**
 * Presentational maps for task status + priority: ordering, i18n key suffixes,
 * and `@tale/ui` Badge variants. Pure constants shared across board/table/detail.
 */

import type { Doc } from '@/convex/_generated/dataModel';

export type TaskStatus = Doc<'tasks'>['status'];
export type TaskPriority = NonNullable<Doc<'tasks'>['priority']>;
/** Polymorphic actor type shared by assignees, comment authors, and activity. */
export type TaskActorType = NonNullable<Doc<'tasks'>['assigneeType']>;
/** Creator attribution type — superset of {@link TaskActorType} that also
 *  includes `'app'` (a task provisioned by an installed app; `createdBy` is the
 *  app slug). A task can't be ASSIGNED to an app, so this is distinct. */
export type TaskCreatorType = NonNullable<Doc<'tasks'>['createdByType']>;

/** Canonical status order (status pickers, full-status surfaces). */
export const TASK_STATUS_ORDER: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
];

/**
 * Statuses the Board renders as lanes and the List as sections (left → right /
 * top → bottom). `backlog` is the leftmost lane — proposed work (often synced
 * by automations) uses the same card, modal, and status picker as every other
 * status.
 */
export const BOARD_TASK_STATUSES: TaskStatus[] = TASK_STATUS_ORDER;

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
  'dependency.added': 'activity.dependencyAdded',
  'dependency.removed': 'activity.dependencyRemoved',
};

/** Statuses that count a blocker as resolved (no longer blocking its dependents). */
export const TASK_TERMINAL_STATUSES = new Set<TaskStatus>([
  'done',
  'cancelled',
]);

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
