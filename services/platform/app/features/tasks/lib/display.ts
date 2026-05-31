/**
 * Presentational maps for task status + priority: ordering, i18n key suffixes,
 * and `@tale/ui` Badge variants. Pure constants shared across board/table/detail.
 */

import type { Doc } from '@/convex/_generated/dataModel';

export type TaskStatus = Doc<'tasks'>['status'];
export type TaskPriority = NonNullable<Doc<'tasks'>['priority']>;

/** Board column order (left → right). */
export const TASK_STATUS_ORDER: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
];

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

export const TASK_PRIORITY_BADGE_VARIANT: Record<TaskPriority, BadgeVariant> = {
  p0: 'destructive',
  p1: 'orange',
  p2: 'yellow',
  p3: 'outline',
};
