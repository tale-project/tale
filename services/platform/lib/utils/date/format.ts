import dayjs, { Dayjs } from 'dayjs';

import './dayjs-setup'; // Ensure dayjs is configured with all plugins and locales

export type DatePreset = 'short' | 'medium' | 'long' | 'time' | 'relative';

export interface FormatDateOptions {
  preset?: DatePreset;
  locale: string;
  timezone?: string;
  customFormat?: string;
}

export interface DateTranslations {
  today: string;
  yesterday: string;
}

/**
 * Apply the best available dayjs locale, trying the full regional key first
 * (e.g. 'en-gb'), then falling back to the base language (e.g. 'en').
 *
 * When neither the regional nor base locale is registered, the original Dayjs
 * object is returned unchanged to avoid silently relying on dayjs's global
 * default locale (commonly 'en').
 */
function applyLocale(d: Dayjs, locale: string): Dayjs {
  if (!locale) return d;

  const key = locale.toLowerCase().replace('_', '-');
  const base = key.split('-')[0];

  const withRegion = d.locale(key);
  if (withRegion.locale() === key) return withRegion;

  if (key !== base) {
    const withBase = d.locale(base);
    if (withBase.locale() === base) return withBase;
  }

  return d;
}

/**
 * Check if timestamp has timezone information using ISO 8601 format patterns
 */
function hasTimezoneInfo(timestamp: string): boolean {
  // Check for 'Z' (UTC) or timezone offset patterns (+/-HH:MM or +/-HHMM)
  const timezonePattern = /Z$|[+-]\d{2}:?\d{2}$/;
  return timezonePattern.test(timestamp);
}

/**
 * Centralized date formatting function with locale support and presets
 */
export function formatDate(
  date: string | Date | Dayjs,
  options: FormatDateOptions,
): string {
  const { preset = 'medium', locale, timezone, customFormat } = options;

  if (!date) return '';

  try {
    let dayjsDate: Dayjs;

    // Handle different input types
    if (typeof date === 'string') {
      // Ensure timestamp is treated as UTC if it doesn't have timezone info
      const utcTimestamp = hasTimezoneInfo(date) ? date : date + 'Z';
      dayjsDate = dayjs(utcTimestamp);
    } else {
      dayjsDate = dayjs(date);
    }

    // Validate the date
    if (!dayjsDate.isValid()) {
      console.warn('Invalid date provided to formatDate:', date);
      return '';
    }

    dayjsDate = applyLocale(dayjsDate, locale);

    // Apply timezone if specified
    if (timezone) {
      dayjsDate = dayjsDate.tz(timezone);
    }

    // Handle relative formatting
    if (preset === 'relative') {
      return dayjsDate.fromNow();
    }

    // Use custom format if provided
    if (customFormat) {
      return dayjsDate.format(customFormat);
    }

    // Use dayjs localized formats
    switch (preset) {
      case 'short':
        return dayjsDate.format('L'); // 09/04/1986 (localized)
      case 'medium':
        return dayjsDate.format('LL'); // September 4, 1986 (localized)
      case 'long':
        return dayjsDate.format('LLL'); // September 4, 1986 8:30 PM (localized)
      case 'time':
        return dayjsDate.format('LT'); // 8:30 PM (localized)
      default:
        return dayjsDate.format('LL');
    }
  } catch (error) {
    console.error('Error formatting date:', error, { date, options });
    return '';
  }
}

/** Default translations for date strings */
const defaultDateTranslations: DateTranslations = {
  today: 'Today',
  yesterday: 'Yesterday',
};

/**
 * Format date with relative time for today/yesterday, otherwise use preset
 *
 * @param date - The date to format
 * @param options - Format options including preset and locale
 * @param translations - Localized strings for "Today" and "Yesterday"
 */
export function formatDateSmart(
  date: string | Date | Dayjs,
  options: FormatDateOptions,
  translations: DateTranslations = defaultDateTranslations,
): string {
  const { locale, preset = 'short' } = options;

  if (!date) return '';

  try {
    let dayjsDate: Dayjs;

    if (typeof date === 'string') {
      const utcTimestamp = hasTimezoneInfo(date) ? date : date + 'Z';
      dayjsDate = dayjs(utcTimestamp);
    } else {
      dayjsDate = dayjs(date);
    }

    if (!dayjsDate.isValid()) return '';

    dayjsDate = applyLocale(dayjsDate, locale);

    if (dayjsDate.isToday()) {
      return formatDate(dayjsDate, { preset: 'time', locale });
    }

    if (dayjsDate.isYesterday()) {
      const timeStr = formatDate(dayjsDate, { preset: 'time', locale });
      return `${translations.yesterday} ${timeStr}`;
    }

    return formatDate(dayjsDate, { preset, locale });
  } catch (error) {
    console.error('Error in formatDateSmart:', error);
    return '';
  }
}

/**
 * Format date header for grouping (Today, Yesterday, or full date)
 *
 * @param date - The date to format
 * @param options - Format options including locale
 * @param translations - Localized strings for "Today" and "Yesterday"
 */
export function formatDateHeader(
  date: string | Date | Dayjs,
  options: FormatDateOptions,
  translations: DateTranslations = defaultDateTranslations,
): string {
  const { locale } = options;

  if (!date) return '';

  try {
    let dayjsDate: Dayjs;

    if (typeof date === 'string') {
      const utcTimestamp = hasTimezoneInfo(date) ? date : date + 'Z';
      dayjsDate = dayjs(utcTimestamp);
    } else {
      dayjsDate = dayjs(date);
    }

    if (!dayjsDate.isValid()) return '';

    dayjsDate = applyLocale(dayjsDate, locale);

    if (dayjsDate.isToday()) {
      return translations.today;
    }

    if (dayjsDate.isYesterday()) {
      return translations.yesterday;
    }

    return formatDate(dayjsDate, { preset: 'medium', locale });
  } catch (error) {
    console.error('Error in formatDateHeader:', error);
    return '';
  }
}

/**
 * Export dayjs instance for direct use when needed
 */
export { default as dayjs } from './dayjs-setup';
export { loadDayjsLocale, isDayjsLocaleLoaded } from './dayjs-setup';
