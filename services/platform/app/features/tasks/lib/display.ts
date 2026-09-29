/**
 * Presentational maps for task status + priority: ordering, i18n key suffixes,
 * and `@tale/ui` Badge variants. Pure constants shared across board/table/detail.
 */

import type { TaskRow } from '@/app/lib/backend/contract/docs';

/**
 * One attached label as the read paths return it. The stored document holds
 * `labelIds` into the project catalog; the task read layer resolves
 * those to `{ id, name, color }` before they reach the client. `id` is absent
 * only for a document still carrying pre-catalog string labels (see
 * `withResolvedLabels`' mid-migration fallback).
 */
export type TaskLabelRef = {
  id?: string;
  name: string;
  color: string;
};

/**
 * A task as every read path returns it: the stored document with `labels`
 * swapped from the raw id array to resolved catalog rows. Client code should
 * type tasks as `TaskDoc`, never `TaskRow` — the latter is the *storage*
 * shape and its `labels` is the retired string array.
 */
export type TaskDoc = Omit<TaskRow, 'labels'> & {
  labels?: TaskLabelRef[];
};

export type TaskStatus = TaskRow['status'];
export type TaskPriority = NonNullable<TaskRow['priority']>;
/** Polymorphic actor type shared by assignees, comment authors, and activity. */
export type TaskActorType = NonNullable<TaskRow['assigneeType']>;
/** Creator attribution type — superset of {@link TaskActorType} that also
 *  includes `'app'` (a task provisioned by an installed app; `createdBy` is the
 *  app slug). A task can't be ASSIGNED to an app, so this is distinct. */
export type TaskCreatorType = NonNullable<TaskRow['createdByType']>;

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
 * Maps a stored activity `action` (see `recordActivity` in
 * `backend/domains/tasks/service.ts`) to its `tasks` i18n key. Unknown
 * actions fall back to the raw string at the call site, so the timeline
 * degrades gracefully if a new action ships.
 *
 * Per-field editor actions (`title.changed`, `priority.changed`, …) carry the
 * previous and new value in `fromValue` / `toValue` so the timeline can
 * show `Old → New` for every edit; the generic `updated` action is kept
 * for legacy rows but new `updateTask` writes emit one row per field.
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
  'title.changed': 'activity.titleChanged',
  'description.changed': 'activity.descriptionChanged',
  'priority.changed': 'activity.priorityChanged',
  'labels.changed': 'activity.labelsChanged',
  'attachments.changed': 'activity.attachmentsChanged',
  'startDate.changed': 'activity.startDateChanged',
  'dueDate.changed': 'activity.dueDateChanged',
  'repeat.changed': 'activity.repeatChanged',
  'repeat.next': 'activity.repeatNext',
  'reviewer.changed': 'activity.reviewerChanged',
  'comment.added': 'activity.commentAdded',
  'dependency.added': 'activity.dependencyAdded',
  'dependency.removed': 'activity.dependencyRemoved',
  'agent_run.refused': 'activity.agentRunRefused',
};

/**
 * What an activity row's stored values are: the history reads each one as the
 * field its action changed, never by what the text happens to spell. A title,
 * a description, a label or a file name that reads `done` stays `done`; only a
 * status, a priority and a refusal code are codes the reader sees as words.
 */
export type TaskActivityValueKind =
  /** A task status code (`todo`, `done`, …). */
  | 'status'
  /** A priority code (`p0` … `p3`). */
  | 'priority'
  /** A member's or an agent's id. */
  | 'person'
  /** A day, as epoch milliseconds. */
  | 'date'
  /** A repeat rule, as the JSON it is stored as. */
  | 'repeat'
  /** A run-admission refusal code. */
  | 'refusal'
  /** What someone typed or named, shown exactly as stored. */
  | 'text';

export interface TaskActivityField {
  kind: TaskActivityValueKind;
  /**
   * The `tasks` i18n key naming an empty side — the `''` the editor stores
   * for a field it cleared, or for one that was empty before it was set — so
   * a cleared due date reads "Oct 1 → No due date", not the date it had.
   */
  emptyKey?: string;
  /**
   * The writer leaves an empty side out instead of storing `''` (an assignee
   * change, a repeat change). For every other field, an end the row does not
   * carry was never recorded, and the history invents nothing for it.
   */
  absentIsEmpty?: true;
}

/**
 * How the history reads the values of each stored activity `action` (see
 * `recordActivity` and `stringifyEditValue` in
 * `backend/domains/tasks/service.ts`). An action missing here reads as text.
 */
export const TASK_ACTIVITY_FIELD: Record<string, TaskActivityField> = {
  created: { kind: 'status' },
  'status.changed': { kind: 'status' },
  'priority.changed': { kind: 'priority', emptyKey: 'priority.none' },
  'assignee.changed': {
    kind: 'person',
    emptyKey: 'assignee.unassigned',
    absentIsEmpty: true,
  },
  'reviewer.changed': { kind: 'person', emptyKey: 'reviewer.none' },
  'startDate.changed': { kind: 'date', emptyKey: 'activity.empty.startDate' },
  'dueDate.changed': { kind: 'date', emptyKey: 'activity.empty.dueDate' },
  'repeat.changed': { kind: 'repeat', absentIsEmpty: true },
  'title.changed': { kind: 'text' },
  'description.changed': {
    kind: 'text',
    emptyKey: 'activity.empty.description',
  },
  'labels.changed': { kind: 'text', emptyKey: 'activity.empty.labels' },
  'attachments.changed': {
    kind: 'text',
    emptyKey: 'activity.empty.attachments',
  },
  'agent_run.refused': { kind: 'refusal' },
};

/**
 * Maps a stored priority code (a `priority.changed` row's `fromValue` /
 * `toValue`) to its `tasks` i18n key; anything else is a raw code we never
 * want the reader to see. The empty side ("no priority") is the field's
 * `emptyKey` in {@link TASK_ACTIVITY_FIELD}.
 */
export const TASK_PRIORITY_LABEL_KEY: Record<string, string> = {
  p0: 'priority.p0',
  p1: 'priority.p1',
  p2: 'priority.p2',
  p3: 'priority.p3',
};

/**
 * Maps a run-admission `refusedReason` code (stored as the `toValue` of an
 * `'agent_run.refused'` activity row)
 * to its `tasks` i18n key. Unknown codes fall back to the raw string at the
 * call site. Lowercase phrases: they render mid-sentence in the timeline.
 */
export const TASK_RUN_REFUSAL_LABEL_KEY: Record<string, string> = {
  agent_disabled: 'agentRuns.refused.agent_disabled',
  agent_not_found: 'agentRuns.refused.agent_not_found',
  automation_disabled: 'agentRuns.refused.automation_disabled',
  budget_paused: 'agentRuns.refused.budget_paused',
  task_circuit_breaker: 'agentRuns.refused.task_circuit_breaker',
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
