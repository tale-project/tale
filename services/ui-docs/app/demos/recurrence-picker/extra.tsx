import { Checkbox } from '@tale/ui/checkbox';
import type { CalendarDay, RecurrenceRule } from '@tale/ui/recurrence';
import { RecurrencePicker } from '@tale/ui/recurrence-picker';
import { CalendarSync } from 'lucide-react';
import { useState } from 'react';

/** The task's due date, Tuesday, September 29, 2026, with its weekday. */
const DUE = { year: 2026, month: 9, day: 29, weekday: 2 };

/** Whether the rule names the day `offset` days after the due date. */
function onRule(rule: RecurrenceRule, offset: number): boolean {
  const date = new Date(Date.UTC(DUE.year, DUE.month - 1, DUE.day + offset));
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  switch (rule.frequency) {
    case 'daily':
      return offset % rule.interval === 0;
    case 'weekly': {
      // Weeks run Monday to Sunday; the due date's week is week 0.
      const week = Math.floor((offset + ((DUE.weekday + 6) % 7)) / 7);
      return (
        week % rule.interval === 0 && rule.weekdays.includes(date.getUTCDay())
      );
    }
    case 'monthly': {
      const months = (year - DUE.year) * 12 + month - DUE.month;
      return (
        months % rule.interval === 0 && day === Math.min(rule.monthDay, lastDay)
      );
    }
    case 'yearly':
      return (
        (year - DUE.year) % rule.interval === 0 &&
        month === rule.month &&
        day === Math.min(rule.monthDay, lastDay)
      );
  }
}

/**
 * A toy stepper standing in for the host's calendar arithmetic: it walks the
 * days after the due date in UTC and keeps the first three the rule names,
 * clamping a missing day to the month's last. A real host steps in the time
 * zone the rule was set in.
 */
function nextDates(rule: RecurrenceRule): CalendarDay[] {
  const found: CalendarDay[] = [];
  for (let offset = 1; offset < 1100 && found.length < 3; offset++) {
    if (!onRule(rule, offset)) continue;
    const date = new Date(Date.UTC(DUE.year, DUE.month - 1, DUE.day + offset));
    found.push({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  }
  return found;
}

export default function RecurrencePickerExtra() {
  const [rule, setRule] = useState<RecurrenceRule | null>({
    frequency: 'monthly',
    interval: 1,
    monthDay: 29,
  });
  const [onDueDate, setOnDueDate] = useState(false);

  return (
    <div className="w-full max-w-xs">
      <RecurrencePicker<boolean>
        value={rule}
        reference={DUE}
        icon={onDueDate ? CalendarSync : undefined}
        description={
          onDueDate
            ? 'The next task is created on the due date.'
            : 'The next task is created when this one is done.'
        }
        nextDates={nextDates}
        nextDatesLabel="Next due dates"
        extra={onDueDate}
        onChange={(next, nextOnDueDate) => {
          setRule(next);
          setOnDueDate(nextOnDueDate);
        }}
        renderExtra={({ rule: draft, extra, setExtra }) =>
          draft ? (
            <Checkbox
              label="Create the next task on the due date"
              description="Even if this one is still open on Tue, Sep 29."
              checked={extra}
              onCheckedChange={(checked) => setExtra(checked === true)}
            />
          ) : null
        }
      />
    </div>
  );
}
