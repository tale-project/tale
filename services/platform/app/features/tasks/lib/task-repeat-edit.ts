import type { RecurrenceReference } from '@tale/ui/recurrence';

import {
  firstTaskRepeatOccurrence,
  localTimeZone,
  startOfCalendarDate,
  startOfTodayIn,
  taskDateIn,
  type TaskRepeat,
  weekdayOf,
} from '@/lib/shared/task-repeat';

import {
  TASK_TERMINAL_STATUSES,
  type TaskActorType,
  type TaskCreatorType,
  type TaskStatus,
} from './display';

/** The dates a Repeat choice is read against and dated from. */
export interface TaskRepeatDates {
  dueDate?: number;
  startDate?: number;
}

/**
 * Whether an automation owns a task — one assigned to an automation, or
 * unassigned and created by one — the server's rule, mirrored so the panel
 * never offers a choice it would refuse. Its lifecycle is the automation's to
 * run, so it never repeats.
 */
export function taskAutomationOwned(task: {
  assigneeType?: TaskActorType;
  assigneeId?: string;
  createdByType?: TaskCreatorType;
}): boolean {
  if (task.assigneeType === 'app') return true;
  const unassigned =
    task.assigneeType === undefined || task.assigneeId === undefined;
  return unassigned && task.createdByType === 'app';
}

/**
 * Whether a task may carry a repeat rule of its own. A subtask never does:
 * it comes back with its parent's next task instead. Nor does a task an
 * automation owns ({@link taskAutomationOwned}).
 */
export function canTaskRepeat(task: {
  parentTaskId?: string;
  assigneeType?: TaskActorType;
  assigneeId?: string;
  createdByType?: TaskCreatorType;
}): boolean {
  return task.parentTaskId === undefined && !taskAutomationOwned(task);
}

/**
 * The day the Repeat presets are read off: the task's due date; without one,
 * its start date while that is still ahead; otherwise today's midnight in
 * `timeZone`. Never the current instant — read at its nearest midnight, an
 * afternoon would name tomorrow.
 */
export function taskRepeatReference(
  dates: TaskRepeatDates,
  now: number,
  timeZone: string = localTimeZone(),
): number {
  if (dates.dueDate !== undefined) return dates.dueDate;
  const today = startOfTodayIn(timeZone, now);
  if (
    dates.startDate !== undefined &&
    startOfCalendarDate(taskDateIn(dates.startDate, timeZone), timeZone) > today
  ) {
    return dates.startDate;
  }
  return today;
}

/**
 * What to write when a rule is picked. A series needs a date to step from,
 * so a task with no due date gets the first day the rule names — on or after
 * today, and never before its start date, which the server would refuse as
 * an out-of-order schedule. A due date already set stays; `null` stops the
 * series and keeps whatever dates were set.
 */
export function taskRepeatPatch(
  rule: TaskRepeat | null,
  dates: TaskRepeatDates,
  now: number,
): { repeat: TaskRepeat | null; dueDate?: number } {
  if (rule === null) return { repeat: null };
  if (dates.dueDate !== undefined) return { repeat: rule };
  return {
    repeat: rule,
    dueDate: firstTaskRepeatOccurrence(rule, now, dates.startDate),
  };
}

/**
 * {@link taskRepeatReference} as the picker reads it: the calendar day in
 * the rule's zone, with its weekday — the one piece of calendar arithmetic
 * the design system leaves to its host.
 */
export function taskRepeatReferenceDay(
  dates: TaskRepeatDates,
  now: number,
  timeZone: string,
): RecurrenceReference {
  const day = taskDateIn(taskRepeatReference(dates, now, timeZone), timeZone);
  return { ...day, weekday: weekdayOf(day) };
}

export type TaskRepeatLockReason =
  | 'subtask'
  | 'automation'
  | 'continued'
  | 'stopped'
  | 'nextDeleted'
  | 'closed'
  | 'notOpen';

/** How the Repeat row renders, and — when it cannot be changed — why. */
export type TaskRepeatFieldState =
  | { kind: 'hidden' }
  | { kind: 'readOnly' }
  | { kind: 'editable' }
  /** A subtask whose parent repeats: it comes back with the parent's next
   *  task. `parent` names the parent — its identifier, else its title. */
  | { kind: 'locked'; reason: 'subtask'; parent: string }
  /** The series already continues on a next task that still repeats;
   *  `nextTask` names it once it has loaded. */
  | { kind: 'locked'; reason: 'continued'; nextTask?: string }
  /** `stopped`: the task continued its series, and the series ends there —
   *  this task's rule, or its next task's, was cleared since ("Stop
   *  repeating" clears this task's, whether it took the next task back or
   *  not). `nextDeleted`: the task continued its series and still carries
   *  its rule, but that next task was deleted since. This task cannot
   *  continue again, even when a later task still carries the series. */
  | {
      kind: 'locked';
      reason: Exclude<TaskRepeatLockReason, 'subtask' | 'continued'>;
    };

/**
 * Which Repeat row a task gets. When several reasons apply, the first one
 * here wins:
 *
 * 1. a subtask — it has no rule of its own; while its parent repeats the row
 *    says it comes back with it, otherwise (while the parent loads, or once
 *    the subtask is archived — archived subtasks are never copied) there is
 *    no row at all;
 * 2. no right to change the task (or it is archived) — the rule as text;
 * 3. an automation owns it;
 * 4. the task already continued its series — which it never does again,
 *    even once that next task is deleted: the series has stopped once this
 *    task's rule was cleared (a "Stop repeating" that took the next task
 *    back reads as a stop, not as a deletion), has ended once the next
 *    task was deleted, has stopped once the next task's rule was cleared,
 *    and otherwise continues on the next task (while it loads, too);
 * 5. the task is closed (details) or being created closed (create);
 * 6. otherwise, the picker.
 */
export function taskRepeatFieldState(input: {
  mode: 'create' | 'details';
  /** Details: may edit and not archived. Create: always. */
  canMutate: boolean;
  status: TaskStatus;
  parentTaskId?: string;
  /** Details: whether the task is archived. */
  archived?: boolean;
  /** Whether the parent carries a rule; `undefined` while it loads. */
  parentRepeats?: boolean;
  /** The parent's identifier, else its title. */
  parentLabel?: string;
  /** {@link taskAutomationOwned}, or a resolved owning automation; in the
   *  create form, an automation picked as the assignee. */
  automationOwned: boolean;
  /** Details: whether the task carries a rule of its own. */
  repeats?: boolean;
  /** Details: whether the task has continued its series — still true once
   *  that next task is deleted. */
  continued?: boolean;
  /** The task that continues this one's series, while it exists. */
  nextTaskId?: string;
  /** Whether that task carries a rule; `undefined` while it loads. */
  nextRepeats?: boolean;
  /** That task's identifier, else its title, once it has loaded. */
  nextTaskLabel?: string;
}): TaskRepeatFieldState {
  if (input.parentTaskId !== undefined) {
    return input.archived !== true &&
      input.parentRepeats === true &&
      input.parentLabel !== undefined
      ? { kind: 'locked', reason: 'subtask', parent: input.parentLabel }
      : { kind: 'hidden' };
  }
  if (!input.canMutate) return { kind: 'readOnly' };
  if (input.automationOwned) return { kind: 'locked', reason: 'automation' };
  if (input.continued === true) {
    if (input.repeats !== true) {
      return { kind: 'locked', reason: 'stopped' };
    }
    if (input.nextTaskId === undefined) {
      return { kind: 'locked', reason: 'nextDeleted' };
    }
    if (input.nextRepeats === false) {
      return { kind: 'locked', reason: 'stopped' };
    }
    return input.nextTaskLabel === undefined
      ? { kind: 'locked', reason: 'continued' }
      : { kind: 'locked', reason: 'continued', nextTask: input.nextTaskLabel };
  }
  if (TASK_TERMINAL_STATUSES.has(input.status)) {
    return {
      kind: 'locked',
      reason: input.mode === 'create' ? 'notOpen' : 'closed',
    };
  }
  return { kind: 'editable' };
}
