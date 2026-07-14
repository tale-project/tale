import { z } from 'zod';

export type MetricsPeriodDays = 7 | 30 | 90;

/**
 * Shared URL search schema for 7/30/90-day metrics windows. The router parses
 * a bare `?period=90` as the JSON number 90, which fails a plain string enum
 * and crashes the page via SearchParamError (bug class #1987/#2024/#2033).
 * Coerce to a string first, then fall back to the default window for any
 * out-of-range value so a shared/bookmarked URL never renders the error
 * boundary.
 */
export const metricsPeriodSearchSchema = z.object({
  period: z.coerce
    .string()
    .pipe(z.enum(['7', '30', '90']))
    .catch('30')
    .optional(),
});

export function parseMetricsPeriodDays(
  period: string | undefined,
  defaultPeriod: MetricsPeriodDays = 30,
): MetricsPeriodDays {
  if (period === '7') return 7;
  if (period === '90') return 90;
  if (period === '30') return 30;
  return defaultPeriod;
}

export function metricsPeriodToParam(
  days: MetricsPeriodDays,
): '7' | '30' | '90' {
  if (days === 7) return '7';
  if (days === 90) return '90';
  return '30';
}
