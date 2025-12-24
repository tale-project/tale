'use client';

import { Dayjs } from 'dayjs';
import { useLocale } from './use-locale';
import {
  formatDate,
  formatDateSmart,
  formatDateHeader,
  DatePreset,
  FormatDateOptions,
  DateTranslations,
} from '@/lib/utils/date/format';
import { useT } from '@/lib/i18n';

export interface UseDateFormatReturn {
  formatDate: (
    date: string | Date | Dayjs,
    preset?: DatePreset,
    options?: Omit<FormatDateOptions, 'locale' | 'preset'>,
  ) => string;
  formatDateSmart: (
    date: string | Date | Dayjs,
    preset?: DatePreset,
    options?: Omit<FormatDateOptions, 'locale' | 'preset'>,
  ) => string;
  formatDateHeader: (
    date: string | Date | Dayjs,
    options?: Omit<FormatDateOptions, 'locale'>,
  ) => string;
  formatRelative: (date: string | Date | Dayjs) => string;
  locale: string;
}

/**
 * Hook that combines locale management with date formatting functionality
 * Provides convenient methods for formatting dates with automatic locale application
 */
export function useDateFormat(): UseDateFormatReturn {
  const { locale } = useLocale();
  const { t } = useT('common');

  // Get localized date translations
  const dateTranslations: DateTranslations = {
    today: t('dates.today'),
    yesterday: t('dates.yesterday'),
  };

  // Format date with automatic locale application
  const formatDateWithLocale = (
    date: string | Date | Dayjs,
    preset: DatePreset = 'medium',
    options: Omit<FormatDateOptions, 'locale' | 'preset'> = {},
  ): string => {
    return formatDate(date, {
      ...options,
      preset,
      locale,
    });
  };

  // Smart format with automatic locale application
  const formatDateSmartWithLocale = (
    date: string | Date | Dayjs,
    preset: DatePreset = 'short',
    options: Omit<FormatDateOptions, 'locale' | 'preset'> = {},
  ): string => {
    return formatDateSmart(
      date,
      {
        ...options,
        preset,
        locale,
      },
      dateTranslations,
    );
  };

  // Format date header with automatic locale application
  const formatDateHeaderWithLocale = (
    date: string | Date | Dayjs,
    options: Omit<FormatDateOptions, 'locale'> = {},
  ): string => {
    return formatDateHeader(
      date,
      {
        ...options,
        locale,
      },
      dateTranslations,
    );
  };

  // Format relative time with automatic locale application
  const formatRelative = (date: string | Date | Dayjs): string => {
    return formatDate(date, {
      preset: 'relative',
      locale,
    });
  };

  return {
    formatDate: formatDateWithLocale,
    formatDateSmart: formatDateSmartWithLocale,
    formatDateHeader: formatDateHeaderWithLocale,
    formatRelative,
    locale,
  };
}
