'use client';

import { Button } from '@tale/ui/button';
import { Checkbox } from '@tale/ui/checkbox';
import type { RecurrenceRule } from '@tale/ui/recurrence';
import {
  type RecurrenceExtraContext,
  RecurrencePicker,
} from '@tale/ui/recurrence-picker';
import { useRecurrenceFormat } from '@tale/ui/use-recurrence-format';
import type { TFunction } from 'i18next';
import { CalendarSync, Repeat } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  localTimeZone,
  parseTaskRepeat,
  sameTaskRepeat,
  startOfCalendarDate,
  TASK_REPEAT_MAX_INTERVAL,
  taskDateIn,
  type TaskRepeat,
  taskRepeatCreateOn,
  type TaskRepeatCreateOn,
  upcomingTaskRepeatDates,
} from '@/lib/shared/task-repeat';

import {
  type TaskRepeatDates,
  type TaskRepeatFieldState,
  taskRepeatPatch,
  taskRepeatReferenceDay,
} from '../lib/task-repeat-edit';

type LockedState = Extract<TaskRepeatFieldState, { kind: 'locked' }>;

/** Why a locked row cannot be changed, as its tooltip and description say. */
function lockReasonText(t: TFunction, state: LockedState): string {
  switch (state.reason) {
    case 'subtask':
      return t('repeat.reason.subtask', { parent: state.parent });
    case 'automation':
      return t('repeat.reason.automation');
    case 'continued':
      return state.nextTask === undefined
        ? t('repeat.reason.continuedUnnamed')
        : t('repeat.reason.continued', { task: state.nextTask });
    case 'stopped':
      return t('repeat.reason.stopped');
    case 'nextDeleted':
      return t('repeat.reason.nextDeleted');
    case 'closed':
      return t('repeat.reason.closed');
    case 'notOpen':
      return t('repeat.reason.notOpen');
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

/**
 * A subtask has no rule of its own: while its parent repeats, it comes back
 * with the parent's next task. The row says so — "↻ With OPS-3" — at full
 * contrast, and stays focusable so the explanation reaches the keyboard as
 * well as the pointer.
 */
function RepeatsWithParent({ id, parent }: { id?: string; parent: string }) {
  const { t } = useT('tasks');
  const { t: tRecurrence } = useT('recurrence');
  const descriptionId = useId();
  const text = t('repeat.withParent', { parent });
  const reason = t('repeat.reason.subtask', { parent });
  return (
    <>
      <Button
        id={id}
        type="button"
        variant="ghost"
        disabled
        disabledReason={reason}
        aria-label={`${tRecurrence('namePrefix', { label: t('repeat.label') })} ${text}`}
        aria-describedby={descriptionId}
        className="h-7 w-full min-w-0 justify-start gap-1.5 px-1.5 text-sm font-normal hover:bg-transparent aria-disabled:cursor-default aria-disabled:opacity-100 aria-disabled:hover:opacity-100"
      >
        <Repeat
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden="true"
        />
        <span className="min-w-0 truncate">{text}</span>
      </Button>
      <span id={descriptionId} hidden>
        {reason}
      </span>
    </>
  );
}

/**
 * A task's Repeat row: the design system's recurrence picker, fed the task's
 * calendar — the day its presets are read off, the next due dates a rule
 * gives, and whether the next task is created on close or on the due date.
 *
 * A rule keeps the zone it was set in; a new one takes the browser's. Picking
 * a rule for a task with no due date also dates it (the series needs a day
 * to step from), and a hidden status line says so. `state` decides whether
 * the row is editable, locked with a reason, plain text, or absent.
 */
export function TaskRepeatField({
  id,
  value,
  dueDate,
  startDate,
  state,
  onChange,
}: {
  /** The id of the row's control — the trigger, or its plain text — so a
   *  neighbour can hand focus back to it. */
  id?: string;
  value: TaskRepeat | null;
  dueDate?: number;
  startDate?: number;
  state: TaskRepeatFieldState;
  /** One write: the rule (`null` stops the series), and the due date a
   *  task without one gets. */
  onChange: (patch: { repeat: TaskRepeat | null; dueDate?: number }) => void;
}) {
  const { t } = useT('tasks');
  const { day } = useRecurrenceFormat();
  const [announcement, setAnnouncement] = useState('');

  if (state.kind === 'hidden') return null;
  if (state.kind === 'locked' && state.reason === 'subtask') {
    return <RepeatsWithParent id={id} parent={state.parent} />;
  }

  const now = Date.now();
  // An edited rule keeps the zone it was set in.
  const timeZone = value?.timezone ?? localTimeZone();
  const dates: TaskRepeatDates = { dueDate, startDate };
  const reference = taskRepeatReferenceDay(dates, now, timeZone);
  const createOn = value ? taskRepeatCreateOn(value) : 'close';
  const withZone = (rule: RecurrenceRule): TaskRepeat => ({
    ...rule,
    timezone: timeZone,
  });
  // The rule as it would be stored; `null` for one the schema refuses.
  const toTaskRepeat = (
    rule: RecurrenceRule,
    nextCreateOn: TaskRepeatCreateOn,
  ): TaskRepeat | null =>
    parseTaskRepeat({ ...withZone(rule), createOn: nextCreateOn });
  const dayText = (ms: number) => day(taskDateIn(ms, timeZone), reference.year);
  // A task that already continued its series never creates another next
  // task, so the line saying when it would is left out: the lock reason
  // says where the series went.
  const handedOn =
    state.kind === 'locked' &&
    (state.reason === 'continued' ||
      state.reason === 'stopped' ||
      state.reason === 'nextDeleted');

  // Under the next due dates, in both views: what a rule does to this task's
  // due date, and whether the next task comes on the due date. `null` when
  // there is nothing to say, so the section collapses.
  const renderExtra = ({
    rule,
    extra,
    setExtra,
  }: RecurrenceExtraContext<TaskRepeatCreateOn>): ReactNode => {
    if (rule === null) {
      return dueDate === undefined ? (
        <p className="text-muted-foreground text-xs">
          {t('repeat.noDueDateHint')}
        </p>
      ) : null;
    }
    const due = upcomingTaskRepeatDates(withZone(rule), dates, now).dueDate;
    const dueDay = taskDateIn(due, timeZone);
    // The due date has begun: a due-date series would continue right away.
    const dueNow = startOfCalendarDate(dueDay, timeZone) <= now;
    // The saved rule, on a task whose due date was cleared since: saving it
    // unchanged writes nothing, so nothing dates the task. Its next task
    // steps from the day it closes, and never comes on a due date — which
    // the option says in place of its usual line. (A description that
    // came and went would remount the checkbox and drop its focus.)
    const savedWithoutDue =
      dueDate === undefined && sameTaskRepeat(toTaskRepeat(rule, extra), value);
    return (
      <>
        {dueDate === undefined && !savedWithoutDue && (
          <p className="text-muted-foreground text-xs">
            {t('repeat.becomesDue', { date: dayText(due) })}
          </p>
        )}
        <Checkbox
          label={t('repeat.onDue.label')}
          description={
            savedWithoutDue
              ? t('repeat.noDueDateSaved')
              : dueNow
                ? t('repeat.onDue.descriptionNow')
                : t('repeat.onDue.description', { date: dayText(due) })
          }
          checked={extra === 'dueDate'}
          onCheckedChange={(checked) =>
            setExtra(checked === true ? 'dueDate' : 'close')
          }
        />
      </>
    );
  };

  return (
    <>
      <RecurrencePicker<TaskRepeatCreateOn>
        id={id}
        value={value}
        reference={reference}
        label={t('repeat.label')}
        icon={createOn === 'dueDate' ? CalendarSync : undefined}
        description={
          value && !handedOn
            ? t(
                createOn === 'dueDate'
                  ? 'repeat.mode.dueDate'
                  : 'repeat.mode.close',
              )
            : undefined
        }
        nextDates={(rule) =>
          upcomingTaskRepeatDates(withZone(rule), dates, now).next.map((ms) =>
            taskDateIn(ms, timeZone),
          )
        }
        nextDatesLabel={t('repeat.nextDueDates')}
        maxInterval={TASK_REPEAT_MAX_INTERVAL}
        extra={createOn}
        renderExtra={renderExtra}
        readOnly={state.kind === 'readOnly'}
        disabled={state.kind === 'locked'}
        disabledReason={
          state.kind === 'locked' ? lockReasonText(t, state) : undefined
        }
        onChange={(rule, nextCreateOn) => {
          const next = rule === null ? null : toTaskRepeat(rule, nextCreateOn);
          if (rule !== null && next === null) {
            console.error(
              '[tasks] the repeat picker emitted a rule the schema refuses',
              rule,
            );
            return;
          }
          if (sameTaskRepeat(next, value)) return;
          const patch = taskRepeatPatch(next, dates, Date.now());
          onChange(patch);
          if (patch.dueDate !== undefined) {
            setAnnouncement(
              t('repeat.dueDateSet', { date: dayText(patch.dueDate) }),
            );
          }
        }}
      />
      <span role="status" className="sr-only">
        {announcement}
      </span>
    </>
  );
}
