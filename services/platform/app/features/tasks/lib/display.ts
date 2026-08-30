/**
 * Presentational maps for task status + priority: ordering, i18n key suffixes,
 * and `@tale/ui` Badge variants. Pure constants shared across board/table/detail.
 */

import type { TaskRow } from '@/app/lib/backend/contract/docs';

/**
 * One attached label as the read paths return it. The stored document holds
 * `labelIds` into the project catalog; `convex/tasks/queries.ts` resolves
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
  'agent_run.refused': 'activity.agentRunRefused',
};

/**
 * Maps a run-admission `refusedReason` code (stored as the `toValue` of an
 * `'agent_run.refused'` activity row — see convex/agents/run_agent_on_task.ts)
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
