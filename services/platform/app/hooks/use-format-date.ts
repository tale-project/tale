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
import { useT } from '@/lib/i18n/client';

export interface UseFormatDateReturn {
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
 * Hook that combines locale management with date formatting functionality.
 * Provides convenient methods for formatting dates with automatic locale application.
 */
export function useFormatDate(): UseFormatDateReturn {
  const { locale } = useLocale();
  const { t } = useT('common');

  const dateTranslations: DateTranslations = {
    today: t('dates.today'),
    yesterday: t('dates.yesterday'),
  };

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
