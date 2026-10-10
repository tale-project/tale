'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useT } from '../i18n/client';
import {
  formatCalendarDay,
  formatOccurrence,
  formatRecurrence,
  formatRecurrenceCompact,
  formatSchedule,
  formatScheduleCompact,
  type RecurrenceCompactLabel,
} from '../lib/recurrence/format';
import type { CalendarDay, RecurrenceRule } from '../lib/recurrence/rule';
import {
  parseScheduleTime,
  type ScheduleOccurrence,
  type ScheduleRule,
  type ScheduleTime,
} from '../lib/recurrence/schedule';
import {
  formatTimeOfDay,
  type HourCycle,
  localHourCycle,
  type TimeOfDay,
} from '../lib/time-of-day';

export interface RecurrenceFormat {
  /** "Every 2 weeks on Tuesday and Thursday". */
  sentence: (rule: RecurrenceRule) => string;
  /** "Every 2 weeks" · "Tue, Thu". */
  compact: (rule: RecurrenceRule) => RecurrenceCompactLabel;
  /** "Tue, Oct 6", with the year when it differs from `referenceYear`. */
  day: (day: CalendarDay, referenceYear?: number) => string;
  /** "Every weekday at 9:00 AM and 5:30 PM"; times in `cycle`, else the
   *  locale's hour cycle. */
  schedule: (rule: ScheduleRule, cycle?: HourCycle) => string;
  /** "Weekdays" · "9:00 AM, 5:30 PM". */
  scheduleCompact: (
    rule: ScheduleRule,
    cycle?: HourCycle,
  ) => RecurrenceCompactLabel;
  /** "9:30 AM", "09:30" — a time of day, or an `"HH:MM"` string. */
  time: (time: TimeOfDay | ScheduleTime, cycle?: HourCycle) => string;
  /** "Tue, Oct 13, 9:00 AM" in the start's zone, with the year when it
   *  differs from `referenceYear`. */
  occurrence: (
    occurrence: ScheduleOccurrence,
    referenceYear?: number,
    cycle?: HourCycle,
  ) => string;
  /** The hour cycle the locale writes times in. */
  hourCycle: HourCycle;
  /** What a missing rule reads as: "Never". */
  never: string;
  /** The locale the names and dates are formatted in. */
  locale: string;
}

/**
 * Recurrence rules and their dates in the reader's language. The locale is
 * the one the i18n instance renders, so it works under a client-side locale
 * preference and under a URL-driven one alike.
 */
export function useRecurrenceFormat(): RecurrenceFormat {
  const { t } = useT('recurrence');
  const { i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  return useMemo(() => {
    const hourCycle = localHourCycle(locale);
    return {
      sentence: (rule: RecurrenceRule) => formatRecurrence(rule, t, locale),
      compact: (rule: RecurrenceRule) =>
        formatRecurrenceCompact(rule, t, locale),
      day: (day: CalendarDay, referenceYear?: number) =>
        formatCalendarDay(day, locale, { referenceYear }),
      schedule: (rule: ScheduleRule, cycle: HourCycle = hourCycle) =>
        formatSchedule(rule, t, locale, cycle),
      scheduleCompact: (rule: ScheduleRule, cycle: HourCycle = hourCycle) =>
        formatScheduleCompact(rule, t, locale, cycle),
      time: (time: TimeOfDay | ScheduleTime, cycle: HourCycle = hourCycle) => {
        if (typeof time !== 'string') {
          return formatTimeOfDay(time, locale, cycle);
        }
        // Text that is not "HH:MM" is shown as it came.
        const parsed = parseScheduleTime(time);
        return parsed === null ? time : formatTimeOfDay(parsed, locale, cycle);
      },
      occurrence: (
        occurrence: ScheduleOccurrence,
        referenceYear?: number,
        cycle: HourCycle = hourCycle,
      ) => formatOccurrence(occurrence, t, locale, { referenceYear, cycle }),
      hourCycle,
      never: t('never'),
      locale,
    };
  }, [t, locale]);
}
