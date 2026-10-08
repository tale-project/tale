import { RecurrencePicker } from '@tale/ui/recurrence-picker';
import type {
  ScheduleOccurrence,
  ScheduleRule,
} from '@tale/ui/recurrence-schedule';
import { Select } from '@tale/ui/select';
import { CalendarClock } from 'lucide-react';
import { useState } from 'react';

/** Today in this example: Tuesday, September 29, 2026. */
const TODAY = { year: 2026, month: 9, day: 29, weekday: 2 };

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(at);
  const part = (type: string) =>
    Number(parts.find((entry) => entry.type === type)?.value);
  const wall = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
  );
  return wall - at;
}

/** The instant a wall-clock minute of a day falls on in a zone. */
function instantOf(dayStart: number, minute: number, timeZone: string) {
  const guess = dayStart + minute * 60_000;
  return guess - offsetAt(guess, timeZone);
}

function minuteOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Whether a times rule runs on the day `offset` days after today. */
function runsOn(rule: ScheduleRule, offset: number): boolean {
  const date = new Date(
    Date.UTC(TODAY.year, TODAY.month - 1, TODAY.day + offset),
  );
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  switch (rule.frequency) {
    case 'daily':
      return offset % rule.interval === 0;
    case 'weekly': {
      const week = Math.floor((offset + ((TODAY.weekday + 6) % 7)) / 7);
      return (
        week % rule.interval === 0 && rule.weekdays.includes(date.getUTCDay())
      );
    }
    case 'monthly': {
      const months =
        (date.getUTCFullYear() - TODAY.year) * 12 +
        date.getUTCMonth() +
        1 -
        TODAY.month;
      return (
        months % rule.interval === 0 &&
        date.getUTCDate() === Math.min(rule.monthDay, lastDay)
      );
    }
    case 'yearly':
      return (
        (date.getUTCFullYear() - TODAY.year) % rule.interval === 0 &&
        date.getUTCMonth() + 1 === rule.month &&
        date.getUTCDate() === Math.min(rule.monthDay, lastDay)
      );
    default:
      return false;
  }
}

/**
 * A toy stand-in for a host's schedule engine: it walks the days from today
 * in the chosen zone and keeps the first three starts. It ignores clock
 * changes; a real host resolves them and marks the starts that meet one.
 */
function nextRuns(rule: ScheduleRule, timeZone: string): ScheduleOccurrence[] {
  const found: ScheduleOccurrence[] = [];
  const now = instantOf(
    Date.UTC(TODAY.year, TODAY.month - 1, TODAY.day),
    12 * 60,
    timeZone,
  );
  for (let offset = 0; offset < 800 && found.length < 3; offset++) {
    const dayStart = Date.UTC(TODAY.year, TODAY.month - 1, TODAY.day + offset);
    const weekday = new Date(dayStart).getUTCDay();
    const minutes: number[] = [];
    if (rule.frequency === 'minutely' || rule.frequency === 'hourly') {
      // A window's weekdays name the day it starts on; an overnight window's
      // hours after midnight belong to the day before.
      const days = rule.window?.weekdays ?? [0, 1, 2, 3, 4, 5, 6];
      const today = days.includes(weekday);
      const yesterday = days.includes((weekday + 6) % 7);
      const step =
        rule.frequency === 'minutely' ? rule.interval : rule.interval * 60;
      const first = rule.frequency === 'hourly' ? rule.minute : 0;
      const hours = rule.window?.hours;
      for (let minute = first; minute < 24 * 60; minute += step) {
        let inside = today;
        if (hours) {
          const from = minuteOf(hours.from);
          const to = minuteOf(hours.to);
          inside =
            from < to
              ? today && minute >= from && minute < to
              : (today && minute >= from) || (yesterday && minute < to);
        }
        if (inside) minutes.push(minute);
      }
    } else if (runsOn(rule, offset)) {
      minutes.push(...rule.times.map(minuteOf));
    }
    for (const minute of minutes) {
      const at = instantOf(dayStart, minute, timeZone);
      if (at > now && found.length < 3) found.push({ at, timeZone });
    }
  }
  return found.toSorted((a, b) => a.at - b.at).slice(0, 3);
}

export default function RecurrencePickerSchedule() {
  const [rule, setRule] = useState<ScheduleRule>({
    frequency: 'weekly',
    interval: 1,
    weekdays: [1, 2, 3, 4, 5],
    times: ['09:00', '17:30'],
  });
  const [zone, setZone] = useState('Europe/Zurich');
  const [saves, setSaves] = useState(0);

  return (
    <div className="flex w-full max-w-xs flex-col gap-3">
      <RecurrencePicker<string, false>
        granularity="time"
        allowNever={false}
        variant="default"
        align="start"
        icon={CalendarClock}
        value={rule}
        reference={TODAY}
        description={`Times in ${zone}.`}
        nextOccurrences={nextRuns}
        extra={zone}
        onChange={(next, nextZone) => {
          setRule(next);
          setZone(nextZone);
          setSaves((count) => count + 1);
        }}
        renderExtra={({ extra, setExtra }) => (
          <Select
            label="Time zone"
            value={extra}
            onValueChange={setExtra}
            options={[
              { value: 'Europe/Zurich', label: 'Europe/Zurich' },
              { value: 'UTC', label: 'UTC' },
            ]}
          />
        )}
      />
      <p className="text-muted-foreground text-sm" aria-live="polite">
        Saved {saves} {saves === 1 ? 'time' : 'times'}, in {zone}.
      </p>
    </div>
  );
}
