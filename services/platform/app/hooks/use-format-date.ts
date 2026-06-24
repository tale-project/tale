'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Dayjs } from 'dayjs';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  formatDate,
  formatDateSmart,
  formatDateHeader,
  loadDayjsLocale,
  DatePreset,
  FormatDateOptions,
  DateTranslations,
} from '@/lib/utils/date/format';

/**
 * Hook that combines locale management with date formatting functionality.
 * Provides convenient methods for formatting dates with automatic locale application.
 */
export function useFormatDate() {
  const { locale } = useLocale();
  const { t } = useT('common');

  // dayjs locales are registered lazily (see `loadDayjsLocale`), and that
  // registration is a global side-effect that does not, on its own, re-render
  // React. Without this, a date can paint with the eagerly-loaded `en` locale
  // before the active locale's data arrives and then stay stuck in English
  // (e.g. a German "Last synced" line showing an English-formatted date). We
  // load the locale here and bump a counter once it's ready so dependent
  // formatting re-runs with the correct locale. Already-loaded locales resolve
  // synchronously, so this is a no-op beyond a single mount-time re-render.
  const [, setLocaleReady] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void loadDayjsLocale(locale).then(() => {
      if (!cancelled) setLocaleReady((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const timezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  const timezoneShort = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { timeZoneName: 'short' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value ?? timezone,
    [locale, timezone],
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
      timezoneShort,
    }),
    [
      formatDateWithLocale,
      formatDateSmartWithLocale,
      formatDateHeaderWithLocale,
      formatRelative,
      locale,
      timezone,
      timezoneShort,
    ],
  );
}
