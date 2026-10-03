'use client';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useT } from '../i18n/client';
import {
  formatCalendarDay,
  formatRecurrence,
  formatRecurrenceCompact,
  type RecurrenceCompactLabel,
} from '../lib/recurrence/format';
import type { CalendarDay, RecurrenceRule } from '../lib/recurrence/rule';

export interface RecurrenceFormat {
  /** "Every 2 weeks on Tuesday and Thursday". */
  sentence: (rule: RecurrenceRule) => string;
  /** "Every 2 weeks" · "Tue, Thu". */
  compact: (rule: RecurrenceRule) => RecurrenceCompactLabel;
  /** "Tue, Oct 6", with the year when it differs from `referenceYear`. */
  day: (day: CalendarDay, referenceYear?: number) => string;
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
  return useMemo(
    () => ({
      sentence: (rule: RecurrenceRule) => formatRecurrence(rule, t, locale),
      compact: (rule: RecurrenceRule) =>
        formatRecurrenceCompact(rule, t, locale),
      day: (day: CalendarDay, referenceYear?: number) =>
        formatCalendarDay(day, locale, { referenceYear }),
      never: t('never'),
      locale,
    }),
    [t, locale],
  );
}
