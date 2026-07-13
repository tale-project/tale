'use client';

import { useLocale } from '@tale/ui/i18n/locale-provider';
import { useMemo } from 'react';

import {
  formatCostCents,
  formatNumber,
  formatPercentShare,
} from '@/lib/utils/format/number';

/**
 * Locale-bound number formatting for the active UI language — the numeric
 * sibling of `useFormatDate`. The pure helpers in `lib/utils/format/number`
 * default to the app's DEFAULT locale, so a bare `formatNumber(1234)` renders
 * "1,234" for a German user; components render through this hook instead so
 * digit grouping, currency, and percentages follow the user's language.
 * Formatter identities are stable per locale — safe in `useMemo`/column deps.
 */
export function useFormatNumber() {
  const { locale } = useLocale();

  return useMemo(
    () => ({
      locale,
      formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
        formatNumber(value, locale, options),
      formatCostCents: (cents: number, currency?: string) =>
        formatCostCents(cents, currency, locale),
      formatPercentShare: (part: number, total: number) =>
        formatPercentShare(part, total, locale),
    }),
    [locale],
  );
}
