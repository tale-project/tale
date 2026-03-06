'use client';

import { Dayjs } from 'dayjs';
import { useCallback, useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  formatDate,
  formatDateSmart,
  formatDateHeader,
  DatePreset,
  FormatDateOptions,
  DateTranslations,
} from '@/lib/utils/date/format';

import { useLocale } from './use-locale';

/**
 * Hook that combines locale management with date formatting functionality.
 * Provides convenient methods for formatting dates with automatic locale application.
 */
export function useFormatDate() {
  const { locale } = useLocale();
  const { t } = useT('common');

  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  const todayLabel = t('dates.today');
  const yesterdayLabel = t('dates.yesterday');

  const dateTranslations = useMemo<DateTranslations>(
    () => ({ today: todayLabel, yesterday: yesterdayLabel }),
    [todayLabel, yesterdayLabel],
  );

  const formatDateWithLocale = useCallback(
    (
      date: string | Date | Dayjs,
      preset: DatePreset = 'medium',
      options: Omit<FormatDateOptions, 'locale' | 'preset'> = {},
    ): string => {
      return formatDate(date, { timezone, ...options, preset, locale });
    },
    [locale, timezone],
  );

  const formatDateSmartWithLocale = useCallback(
    (
      date: string | Date | Dayjs,
      preset: DatePreset = 'short',
      options: Omit<FormatDateOptions, 'locale' | 'preset'> = {},
    ): string => {
      return formatDateSmart(
        date,
        { timezone, ...options, preset, locale },
        dateTranslations,
      );
    },
    [locale, timezone, dateTranslations],
  );

  const formatDateHeaderWithLocale = useCallback(
    (
      date: string | Date | Dayjs,
      options: Omit<FormatDateOptions, 'locale'> = {},
    ): string => {
      return formatDateHeader(
        date,
        { timezone, ...options, locale },
        dateTranslations,
      );
    },
    [locale, timezone, dateTranslations],
  );

  const formatRelative = useCallback(
    (date: string | Date | Dayjs): string => {
      return formatDate(date, { preset: 'relative', locale, timezone });
    },
    [locale, timezone],
  );

  return useMemo(
    () => ({
      formatDate: formatDateWithLocale,
      formatDateSmart: formatDateSmartWithLocale,
      formatDateHeader: formatDateHeaderWithLocale,
      formatRelative,
      locale,
      timezone,
    }),
    [
      formatDateWithLocale,
      formatDateSmartWithLocale,
      formatDateHeaderWithLocale,
      formatRelative,
      locale,
      timezone,
    ],
  );
}
