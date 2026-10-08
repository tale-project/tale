'use client';

import type {
  DatePreset,
  FormatDateOptions,
  DateTranslations,
} from '@tale/ui/date';
import {
  formatDate,
  formatDateSmart,
  formatDateHeader,
  isDayjsLocaleReady,
  loadDayjsLocale,
  localTimeZone,
} from '@tale/ui/date';
import { useT } from '@tale/ui/i18n/client';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import type { Dayjs } from 'dayjs';
import { useCallback, useEffect, useMemo, useState } from 'react';

/** The local zone's short name ("CEST") per locale, read once per locale. */
const timeZoneShortNames = new Map<string, string>();

function timeZoneShortName(locale: string, timezone: string): string {
  const key = `${locale}|${timezone}`;
  let name = timeZoneShortNames.get(key);
  if (name === undefined) {
    name =
      new Intl.DateTimeFormat(locale, { timeZoneName: 'short' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value ?? timezone;
    timeZoneShortNames.set(key, name);
  }
  return name;
}

/**
 * Hook that combines locale management with date formatting functionality.
 * Provides convenient methods for formatting dates with automatic locale application.
 *
 * Lists call it once per row, so it costs nothing per instance beyond its
 * callbacks: the zone and its short name are read once per page, and an
 * instance re-renders for its locale's data only when that data is still on
 * its way.
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
  // formatting re-runs with the correct locale.
  const [, setLocaleReady] = useState(0);
  // Read at render: a row that painted with its locale's data needs no second
  // render, while one that painted before the data arrived always gets one —
  // even when another row's load lands before this effect runs.
  const paintedWithLocale = isDayjsLocaleReady(locale);
  useEffect(() => {
    if (paintedWithLocale) return undefined;
    let cancelled = false;
    void loadDayjsLocale(locale).then(() => {
      if (!cancelled) setLocaleReady((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [locale, paintedWithLocale]);

  const timezone = localTimeZone();
  const timezoneShort = timeZoneShortName(locale, timezone);

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
    (
      date: string | Date | Dayjs,
      options: { withoutSuffix?: boolean } = {},
    ): string => {
      return formatDate(date, {
        ...options,
        preset: 'relative',
        locale,
        timezone,
      });
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
