'use client';

import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import type { TFunction } from 'i18next';
import { type ReactNode, useId } from 'react';

import { useDebounce } from '../../hooks/use-debounce';
import { useRecurrenceFormat } from '../../hooks/use-recurrence-format';
import { useSwapFade } from '../../hooks/use-swap-fade';
import {
  dayBeforeMonth,
  monthDayName,
  monthName,
  weekdayChipLabel,
  weekdayName,
} from '../../lib/recurrence/format';
import {
  maxMonthDay,
  RECURRENCE_FREQUENCIES,
  RECURRENCE_MAX_INTERVAL,
  type RecurrenceDraft,
  type RecurrenceFrequency,
  recurrenceFromDraft,
  WEEKDAYS_MONDAY_FIRST,
  withRecurrenceFrequency,
  withRecurrenceMonth,
} from '../../lib/recurrence/rule';
import { NumberStepper } from './number-stepper';
import { SegmentedControl } from './segmented-control';
import { Select } from './select';
import { ToggleChipGroup } from './toggle-chip-group';

export interface RecurrenceEditorProps {
  /** The rule being edited, in the editor's always-valid form — start one
   *  with `recurrenceDraft(rule, reference)`. */
  draft: RecurrenceDraft;
  onDraftChange: (draft: RecurrenceDraft) => void;
  /** The units offered, in order. @default every frequency */
  frequencies?: readonly RecurrenceFrequency[];
  /** The widest step. @default RECURRENCE_MAX_INTERVAL (99) */
  maxInterval?: number;
  /** Enter in one of the number fields. */
  onSubmit?: () => void;
  /** Id of the visible heading that names the editor. */
  'aria-labelledby'?: string;
  /** The editor's name when no visible heading names it. */
  'aria-label'?: string;
  className?: string;
}

/** The spoken rule waits this long, so a screen reader hears the settled
 *  rule rather than every number while someone holds an arrow key. */
const ANNOUNCE_AFTER_MS = 400;

/** From this day on, some months have no such day. */
const SHORT_MONTH_DAY = 29;

function unitLabel(frequency: RecurrenceFrequency, t: TFunction): string {
  switch (frequency) {
    case 'daily':
      return t('editor.units.daily');
    case 'weekly':
      return t('editor.units.weekly');
    case 'monthly':
      return t('editor.units.monthly');
    case 'yearly':
      return t('editor.units.yearly');
    default: {
      const exhaustive: never = frequency;
      return exhaustive;
    }
  }
}

function unitNoun(
  frequency: RecurrenceFrequency,
  count: number,
  t: TFunction,
): string {
  switch (frequency) {
    case 'daily':
      return t('editor.unitNoun.daily', { count });
    case 'weekly':
      return t('editor.unitNoun.weekly', { count });
    case 'monthly':
      return t('editor.unitNoun.monthly', { count });
    case 'yearly':
      return t('editor.unitNoun.yearly', { count });
    default: {
      const exhaustive: never = frequency;
      return exhaustive;
    }
  }
}

function asFrequency(value: string): RecurrenceFrequency | undefined {
  return RECURRENCE_FREQUENCIES.find((frequency) => frequency === value);
}

/**
 * The form body of a custom repeat rule: the unit, "Every [n] weeks", then
 * what the unit needs — the weekdays, the day of the month, or the date in
 * the year. Controlled: it edits a `RecurrenceDraft`, which is always valid
 * (the number fields clamp, a weekday stays on), so there is no error state.
 * `recurrenceFromDraft(draft)` is the rule it means.
 *
 * It renders no `<form>` of its own, so it can sit inside a host's form;
 * `RecurrencePicker` wraps it in one inside its popover.
 */
export function RecurrenceEditor({
  draft,
  onDraftChange,
  frequencies = RECURRENCE_FREQUENCIES,
  maxInterval = RECURRENCE_MAX_INTERVAL,
  onSubmit,
  'aria-labelledby': ariaLabelledBy,
  'aria-label': ariaLabel,
  className,
}: RecurrenceEditorProps) {
  const { t } = useT('recurrence');
  const format = useRecurrenceFormat();
  const baseId = useId();
  const ids = {
    every: `${baseId}-every`,
    interval: `${baseId}-interval`,
    unitNoun: `${baseId}-unit-noun`,
    onWeekdays: `${baseId}-on-weekdays`,
    onDay: `${baseId}-on-day`,
    monthDay: `${baseId}-month-day`,
    lastDayHint: `${baseId}-last-day-hint`,
    onDate: `${baseId}-on-date`,
    month: `${baseId}-month`,
    monthName: `${baseId}-month-name`,
    yearDay: `${baseId}-year-day`,
    leapDayHint: `${baseId}-leap-day-hint`,
  };
  const announced = useDebounce(
    format.sentence(recurrenceFromDraft(draft)),
    ANNOUNCE_AFTER_MS,
  );
  const paneRef = useSwapFade<HTMLDivElement>(draft.frequency);

  const change = (patch: Partial<RecurrenceDraft>) =>
    onDraftChange({ ...draft, ...patch });

  const rowClasses = 'flex flex-wrap items-center gap-2 text-sm';
  const labelClasses = 'text-muted-foreground text-xs font-medium';

  let pane: ReactNode = null;
  if (draft.frequency === 'weekly') {
    pane = (
      <div className="flex flex-col gap-1.5">
        <span id={ids.onWeekdays} className={labelClasses}>
          {t('editor.onWeekdays')}
        </span>
        <ToggleChipGroup
          aria-labelledby={ids.onWeekdays}
          value={draft.weekdays.map(String)}
          minSelected={1}
          onValueChange={(next) =>
            change({
              weekdays: next.map(Number).toSorted((a, b) => a - b),
            })
          }
          options={WEEKDAYS_MONDAY_FIRST.map((day) => ({
            value: String(day),
            label: weekdayChipLabel(day, t),
            'aria-label': weekdayName(day, format.locale),
          }))}
        />
      </div>
    );
  } else if (draft.frequency === 'monthly') {
    const hint = draft.monthDay >= SHORT_MONTH_DAY;
    pane = (
      <div className="flex flex-col gap-1.5">
        <div className={rowClasses}>
          <span id={ids.onDay}>{t('editor.onDay')}</span>
          <NumberStepper
            id={ids.monthDay}
            aria-labelledby={`${ids.onDay} ${ids.monthDay}`}
            aria-describedby={hint ? ids.lastDayHint : undefined}
            value={draft.monthDay}
            min={1}
            max={31}
            onValueChange={(monthDay) => change({ monthDay })}
            onEnter={onSubmit}
          />
        </div>
        {hint && (
          <p id={ids.lastDayHint} className="text-muted-foreground text-xs">
            {t('editor.lastDayHint')}
          </p>
        )}
      </div>
    );
  } else if (draft.frequency === 'yearly') {
    const leapDay = draft.yearMonth === 2 && draft.yearDay === 29;
    const dayFirst = dayBeforeMonth(format.locale);
    const nameParts = dayFirst
      ? [ids.onDate, ids.yearDay, ids.monthName]
      : [ids.onDate, ids.monthName, ids.yearDay];
    const month = (
      <Select
        key="month"
        id={ids.month}
        aria-label={t('editor.month')}
        value={String(draft.yearMonth)}
        onValueChange={(next) =>
          onDraftChange(withRecurrenceMonth(draft, Number(next)))
        }
        options={Array.from({ length: 12 }, (_, index) => ({
          value: String(index + 1),
          label: monthName(index + 1, format.locale),
        }))}
        wrapperClassName="min-w-0 flex-1"
      />
    );
    const day = (
      <NumberStepper
        key="day"
        id={ids.yearDay}
        aria-labelledby={nameParts.join(' ')}
        aria-describedby={leapDay ? ids.leapDayHint : undefined}
        value={draft.yearDay}
        min={1}
        max={maxMonthDay(draft.yearMonth)}
        onValueChange={(yearDay) => change({ yearDay })}
        onEnter={onSubmit}
      />
    );
    pane = (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-sm">
          <span id={ids.onDate} className="shrink-0">
            {t('editor.onDate')}
          </span>
          {dayFirst ? [day, month] : [month, day]}
          {/* The month's name for the day field's accessible name ("On
              February 29"); the select's own name is "Month". */}
          <span id={ids.monthName} hidden>
            {monthName(draft.yearMonth, format.locale)}
          </span>
        </div>
        {leapDay && (
          <p id={ids.leapDayHint} className="text-muted-foreground text-xs">
            {t('editor.leapDayHint', {
              date: monthDayName(2, 28, format.locale),
            })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabelledBy ? undefined : ariaLabel}
      className={cn('flex flex-col gap-3', className)}
    >
      <SegmentedControl
        aria-label={t('editor.unit')}
        value={draft.frequency}
        onValueChange={(next) => {
          const frequency = asFrequency(next);
          if (frequency)
            onDraftChange(withRecurrenceFrequency(draft, frequency));
        }}
        options={frequencies.map((frequency) => ({
          value: frequency,
          label: unitLabel(frequency, t),
        }))}
        className="w-full"
      />
      <div className={rowClasses}>
        <span id={ids.every}>
          {t('editor.every', { unit: draft.frequency, count: draft.interval })}
        </span>
        <NumberStepper
          id={ids.interval}
          aria-labelledby={`${ids.every} ${ids.interval} ${ids.unitNoun}`}
          value={draft.interval}
          min={1}
          max={maxInterval}
          onValueChange={(interval) => change({ interval })}
          onEnter={onSubmit}
        />
        <span id={ids.unitNoun}>
          {unitNoun(draft.frequency, draft.interval, t)}
        </span>
      </div>
      {pane && <div ref={paneRef}>{pane}</div>}
      <p role="status" className="sr-only">
        {announced}
      </p>
    </div>
  );
}
