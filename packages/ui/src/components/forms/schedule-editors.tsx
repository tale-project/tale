'use client';

import { cn } from '@tale/ui/cn';
import { useT } from '@tale/ui/i18n/client';
import type { TFunction } from 'i18next';
import { Plus, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { useDebounce } from '../../hooks/use-debounce';
import { useRecurrenceFormat } from '../../hooks/use-recurrence-format';
import { weekdayChipLabel, weekdayName } from '../../lib/recurrence/format';
import {
  RECURRENCE_FREQUENCIES,
  type RecurrenceFrequency,
  WEEKDAYS_MONDAY_FIRST,
} from '../../lib/recurrence/rule';
import {
  type HourInterval,
  type MinuteInterval,
  SCHEDULE_HOUR_INTERVALS,
  SCHEDULE_MAX_INTERVAL,
  SCHEDULE_MAX_TIMES,
  SCHEDULE_MINUTE_INTERVALS,
  type ScheduleDraft,
  scheduleFromDraft,
  isScheduleGrid,
  nextFreeTime,
  windowStarts,
} from '../../lib/recurrence/schedule';
import {
  type HourCycle,
  sameTime,
  type TimeOfDay,
} from '../../lib/time-of-day';
import { Button } from '../primitives/button';
import { IconButton } from '../primitives/icon-button';
import { Checkbox } from './checkbox';
import { NumberStepper } from './number-stepper';
import { RecurrenceEditor } from './recurrence-editor';
import { Select } from './select';
import { TimeField } from './time-field';
import { ToggleChipGroup } from './toggle-chip-group';

/** The spoken rule waits this long, so a screen reader hears the settled
 *  rule rather than every step while someone holds an arrow key. */
const ANNOUNCE_AFTER_MS = 400;

const ROW_CLASSES = 'flex flex-wrap items-center gap-2 text-sm';
const LABEL_CLASSES = 'text-muted-foreground text-xs font-medium';

/**
 * The words a status region speaks once `key` has settled: `text` as it
 * reads then. Nothing is spoken for the first key, so opening a view is
 * silent, and a change that leaves `key` alone is not announced again.
 */
function useSettledAnnouncement(text: string, key: string): string {
  const settled = useDebounce(key, ANNOUNCE_AFTER_MS);
  const textRef = useRef(text);
  useLayoutEffect(() => {
    textRef.current = text;
  });
  const lastKey = useRef(settled);
  const [spoken, setSpoken] = useState('');
  useEffect(() => {
    if (settled === lastKey.current) return;
    lastKey.current = settled;
    setSpoken(textRef.current);
  }, [settled]);
  return spoken;
}

/** The first part of the time field inside `container`, to focus. */
function firstPart(container: HTMLElement | null | undefined) {
  return container?.querySelector<HTMLElement>('[role="spinbutton"]') ?? null;
}

function timeKey(times: readonly TimeOfDay[]): string {
  return times.map((time) => `${time.hour}:${time.minute}`).join(',');
}

export interface ScheduleTimesEditorProps {
  draft: ScheduleDraft;
  onDraftChange: (draft: ScheduleDraft) => void;
  frequencies?: readonly RecurrenceFrequency[];
  maxInterval?: number;
  maxTimes?: number;
  hourCycle?: HourCycle;
  /** Enter in a number or time field. */
  onSubmit?: () => void;
  /** Id of the visible heading that names the editor. */
  'aria-labelledby': string;
}

/**
 * The Custom times view's form body: the day picker's own editor for the
 * days, then the times of day it starts at. Rows keep the author's order
 * and may repeat while drafting; the rule sorts them and drops repeats.
 */
export function ScheduleTimesEditor({
  draft,
  onDraftChange,
  frequencies = RECURRENCE_FREQUENCIES,
  maxInterval = SCHEDULE_MAX_INTERVAL,
  maxTimes = SCHEDULE_MAX_TIMES,
  hourCycle,
  onSubmit,
  'aria-labelledby': ariaLabelledBy,
}: ScheduleTimesEditorProps) {
  const { t } = useT('recurrence');
  const format = useRecurrenceFormat();
  const baseId = useId();
  const atId = `${baseId}-at`;
  // Stable keys for the rows, so removing one keeps every other row's own
  // field, and only a row that was just added drops in. A draft the picker
  // replaced (new saved values) starts the keys over.
  const added = useRef(0);
  const [keys, setKeys] = useState<string[]>(() =>
    draft.times.map((_, index) => `row-${index}`),
  );
  const [enteringKey, setEnteringKey] = useState<string | null>(null);
  const rowKeys =
    keys.length === draft.times.length
      ? keys
      : draft.times.map((_, index) => `row-${index}`);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const focusRow = useRef<number | null>(null);

  const rule = scheduleFromDraft(draft, 'times');
  const spoken = useSettledAnnouncement(
    format.schedule(rule, hourCycle),
    timeKey(draft.times),
  );

  // Focus follows an added or removed row, onto its first part.
  useEffect(() => {
    const index = focusRow.current;
    if (index === null) return;
    focusRow.current = null;
    const key = rowKeys[Math.min(index, rowKeys.length - 1)];
    if (key !== undefined) firstPart(rowRefs.current.get(key))?.focus();
  });

  const setTimes = (times: TimeOfDay[]) => onDraftChange({ ...draft, times });

  const addTime = () => {
    if (draft.times.length >= maxTimes) return;
    added.current += 1;
    const key = `added-${added.current}`;
    setKeys([...rowKeys, key]);
    setEnteringKey(key);
    focusRow.current = draft.times.length;
    setTimes([...draft.times, nextFreeTime(draft.times)]);
  };

  const removeTime = (index: number) => {
    setKeys(rowKeys.filter((_, at) => at !== index));
    focusRow.current = index;
    setTimes(draft.times.filter((_, at) => at !== index));
  };

  const atMax = draft.times.length >= maxTimes;

  // The day editor is the group the heading names; the times follow it
  // under their own label.
  return (
    <div className="flex flex-col gap-3">
      <RecurrenceEditor
        aria-labelledby={ariaLabelledBy}
        draft={draft.calendar}
        onDraftChange={(calendar) => onDraftChange({ ...draft, calendar })}
        frequencies={frequencies}
        maxInterval={maxInterval}
        onSubmit={onSubmit}
      />
      <div className="flex flex-col gap-1.5">
        <span id={atId} className={LABEL_CLASSES}>
          {t('editor.at')}
        </span>
        <ul aria-labelledby={atId} className="flex flex-col gap-2">
          {draft.times.map((time, index) => {
            const key = rowKeys[index] ?? `row-${index}`;
            const duplicate = draft.times
              .slice(0, index)
              .some((earlier) => sameTime(earlier, time));
            const hintId = `${baseId}-duplicate-${key}`;
            return (
              <li
                key={key}
                ref={(node) => {
                  if (node) rowRefs.current.set(key, node);
                  else rowRefs.current.delete(key);
                }}
                className={cn(
                  'flex flex-col gap-1',
                  enteringKey === key && 'animate-row-enter',
                )}
              >
                <div className="flex items-center gap-2">
                  <TimeField
                    aria-label={t('editor.timeName', { index: index + 1 })}
                    aria-describedby={duplicate ? hintId : undefined}
                    value={time}
                    hourCycle={hourCycle}
                    onValueChange={(next) =>
                      setTimes(
                        draft.times.map((current, at) =>
                          at === index ? next : current,
                        ),
                      )
                    }
                    onEnter={onSubmit}
                  />
                  {draft.times.length > 1 && (
                    <IconButton
                      type="button"
                      icon={X}
                      size="sm"
                      variant="ghost"
                      aria-label={t('editor.removeTime', {
                        time: format.time(time, hourCycle),
                      })}
                      onClick={() => removeTime(index)}
                    />
                  )}
                </div>
                {duplicate && (
                  <p id={hintId} className="text-muted-foreground text-xs">
                    {t('editor.duplicateTime')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={Plus}
          onClick={addTime}
          disabled={atMax}
          disabledReason={
            atMax ? t('editor.maxTimes', { count: maxTimes }) : undefined
          }
          className="self-start"
        >
          {t('editor.addTime')}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {spoken}
      </p>
    </div>
  );
}

/** One choice of the Every list: a step in minutes or in hours. */
type IntervalChoice = `minutely:${number}` | `hourly:${number}`;

function intervalLabel(
  unit: 'minutely' | 'hourly',
  count: number,
  t: TFunction,
): string {
  return unit === 'minutely'
    ? t('editor.intervalOption.minutely', { count })
    : t('editor.intervalOption.hourly', { count });
}

export interface ScheduleIntervalEditorProps {
  draft: ScheduleDraft;
  onDraftChange: (draft: ScheduleDraft) => void;
  minuteIntervals?: readonly MinuteInterval[];
  hourIntervals?: readonly HourInterval[];
  hourCycle?: HourCycle;
  /** Enter in a number or time field. */
  onSubmit?: () => void;
  /** Id of the visible heading that names the editor. */
  'aria-labelledby': string;
}

/** What the window's hours mean for a grid, as the hint under them says it. */
function windowHint(
  draft: ScheduleDraft,
  t: TFunction,
  formatTime: (time: TimeOfDay) => string,
): { text: string; neverFires: boolean } | null {
  const hours = draft.windowHours;
  if (hours === null) return null;
  if (sameTime(hours.from, hours.to)) {
    return { text: t('editor.windowHint.allDay'), neverFires: false };
  }
  const rule = scheduleFromDraft(draft, 'interval');
  const starts = isScheduleGrid(rule) ? windowStarts(rule) : null;
  if (starts === null) {
    return { text: t('editor.windowHint.none'), neverFires: true };
  }
  const words = {
    first: formatTime(starts.first),
    last: formatTime(starts.last),
  };
  return {
    text: starts.overnight
      ? t('editor.windowHint.overnight', words)
      : t('editor.windowHint.sameDay', words),
    neverFires: false,
  };
}

/**
 * The Custom interval view's form body: every N minutes or hours, the
 * minute past the hour for hours, the weekdays, and optional hours of the
 * day. A window no start falls in is said in red under the hours; the host
 * blocks saving it.
 */
export function ScheduleIntervalEditor({
  draft,
  onDraftChange,
  minuteIntervals = SCHEDULE_MINUTE_INTERVALS,
  hourIntervals = SCHEDULE_HOUR_INTERVALS,
  hourCycle,
  onSubmit,
  'aria-labelledby': ariaLabelledBy,
}: ScheduleIntervalEditorProps) {
  const { t } = useT('recurrence');
  const format = useRecurrenceFormat();
  const baseId = useId();
  const ids = {
    every: `${baseId}-every`,
    minutePast: `${baseId}-minute-past`,
    minutePastLabel: `${baseId}-minute-past-label`,
    onWeekdays: `${baseId}-on-weekdays`,
    hint: `${baseId}-hint`,
  };
  const hoursRef = useRef<HTMLDivElement>(null);
  const focusHours = useRef(false);
  // The minute-past row drops in when the unit switches to hours, not when
  // the view opens on an hourly rule.
  const [unitSwitched, setUnitSwitched] = useState(false);

  useEffect(() => {
    if (!focusHours.current) return;
    focusHours.current = false;
    firstPart(hoursRef.current)?.focus();
  });

  const rule = scheduleFromDraft(draft, 'interval');
  const spoken = useSettledAnnouncement(
    format.schedule(rule, hourCycle),
    format.schedule(rule, hourCycle),
  );
  const hint = windowHint(draft, t, (time) => format.time(time, hourCycle));
  const unit = draft.every.unit;
  const count = unit === 'minutely' ? draft.every.minutes : draft.every.hours;
  const options = [
    ...minuteIntervals.map((minutes) => ({
      value: `minutely:${minutes}` satisfies IntervalChoice,
      label: intervalLabel('minutely', minutes, t),
    })),
    ...hourIntervals.map((hours) => ({
      value: `hourly:${hours}` satisfies IntervalChoice,
      label: intervalLabel('hourly', hours, t),
    })),
  ];

  const chooseInterval = (choice: string) => {
    const [nextUnit, amount] = choice.split(':');
    const step = Number(amount);
    if (nextUnit === 'minutely') {
      const minutes = minuteIntervals.find((offered) => offered === step);
      if (minutes === undefined) return;
      onDraftChange({
        ...draft,
        every: { ...draft.every, unit: 'minutely', minutes },
      });
    } else if (nextUnit === 'hourly') {
      const hours = hourIntervals.find((offered) => offered === step);
      if (hours === undefined) return;
      if (unit !== 'hourly') setUnitSwitched(true);
      onDraftChange({
        ...draft,
        every: { ...draft.every, unit: 'hourly', hours },
      });
    }
  };

  const toggleHours = (on: boolean) => {
    if (on) {
      focusHours.current = true;
      onDraftChange({ ...draft, windowHours: draft.lastWindowHours });
      return;
    }
    onDraftChange({
      ...draft,
      windowHours: null,
      lastWindowHours: draft.windowHours ?? draft.lastWindowHours,
    });
  };

  const setHours = (part: 'from' | 'to', time: TimeOfDay) => {
    const current = draft.windowHours ?? draft.lastWindowHours;
    const windowHours = { ...current, [part]: time };
    onDraftChange({ ...draft, windowHours, lastWindowHours: windowHours });
  };

  return (
    <div
      role="group"
      aria-labelledby={ariaLabelledBy}
      className="flex flex-col gap-3"
    >
      <div className={ROW_CLASSES}>
        <span id={ids.every}>{t('editor.every', { unit, count })}</span>
        <Select
          aria-labelledby={ids.every}
          value={`${unit}:${count}`}
          onValueChange={chooseInterval}
          options={options}
          className="h-9 w-40"
          wrapperClassName="w-40 shrink-0"
        />
      </div>
      {unit === 'hourly' && (
        <div className={cn(ROW_CLASSES, unitSwitched && 'animate-row-enter')}>
          <NumberStepper
            id={ids.minutePast}
            aria-labelledby={`${ids.minutePast} ${ids.minutePastLabel}`}
            value={draft.minutePast}
            min={0}
            max={59}
            pageStep={15}
            onValueChange={(minutePast) =>
              onDraftChange({ ...draft, minutePast })
            }
            onEnter={onSubmit}
          />
          <span id={ids.minutePastLabel}>
            {t('editor.minutePast', { count: draft.minutePast })}
          </span>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <span id={ids.onWeekdays} className={LABEL_CLASSES}>
          {t('editor.onWeekdays')}
        </span>
        <ToggleChipGroup
          aria-labelledby={ids.onWeekdays}
          value={draft.windowDays.map(String)}
          minSelected={1}
          onValueChange={(next) =>
            onDraftChange({
              ...draft,
              windowDays: next.map(Number).toSorted((a, b) => a - b),
            })
          }
          options={WEEKDAYS_MONDAY_FIRST.map((day) => ({
            value: String(day),
            label: weekdayChipLabel(day, t),
            'aria-label': weekdayName(day, format.locale),
          }))}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Checkbox
          label={t('editor.onlyBetween')}
          checked={draft.windowHours !== null}
          onCheckedChange={(checked) => toggleHours(checked === true)}
        />
        {draft.windowHours !== null && (
          <div className="animate-row-enter flex flex-col gap-1.5 pl-6">
            <div ref={hoursRef} className={ROW_CLASSES}>
              <TimeField
                aria-label={t('editor.windowFrom')}
                aria-describedby={hint ? ids.hint : undefined}
                aria-invalid={hint?.neverFires || undefined}
                value={draft.windowHours.from}
                hourCycle={hourCycle}
                onValueChange={(time) => setHours('from', time)}
                onEnter={onSubmit}
              />
              <span aria-hidden="true">{t('editor.and')}</span>
              <TimeField
                aria-label={t('editor.windowUntil')}
                aria-describedby={hint ? ids.hint : undefined}
                aria-invalid={hint?.neverFires || undefined}
                value={draft.windowHours.to}
                hourCycle={hourCycle}
                onValueChange={(time) => setHours('to', time)}
                onEnter={onSubmit}
              />
            </div>
            {hint && (
              <p
                id={ids.hint}
                className={cn(
                  'text-xs',
                  hint.neverFires
                    ? 'text-destructive'
                    : 'text-muted-foreground',
                )}
              >
                {hint.text}
              </p>
            )}
          </div>
        )}
      </div>
      <p role="status" className="sr-only">
        {spoken}
      </p>
    </div>
  );
}
