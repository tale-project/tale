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
      return formatDate(date, { ...options, preset, locale });
    },
    [locale],
  );

  const formatDateSmartWithLocale = useCallback(
    (
      date: string | Date | Dayjs,
      preset: DatePreset = 'short',
      options: Omit<FormatDateOptions, 'locale' | 'preset'> = {},
    ): string => {
      return formatDateSmart(
        date,
        { ...options, preset, locale },
        dateTranslations,
      );
    },
    [locale, dateTranslations],
  );

  const formatDateHeaderWithLocale = useCallback(
    (
      date: string | Date | Dayjs,
      options: Omit<FormatDateOptions, 'locale'> = {},
    ): string => {
      return formatDateHeader(date, { ...options, locale }, dateTranslations);
    },
    [locale, dateTranslations],
  );

  const formatRelative = useCallback(
    (date: string | Date | Dayjs): string => {
      return formatDate(date, { preset: 'relative', locale });
    },
    [locale],
  );

  return useMemo(
    () => ({
      formatDate: formatDateWithLocale,
      formatDateSmart: formatDateSmartWithLocale,
      formatDateHeader: formatDateHeaderWithLocale,
      formatRelative,
      locale,
    }),
    [
      formatDateWithLocale,
      formatDateSmartWithLocale,
      formatDateHeaderWithLocale,
      formatRelative,
      locale,
    ],
  );
}
