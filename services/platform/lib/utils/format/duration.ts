/**
 * Automation-run duration and success-rate formatting, shared by the run
 * tables and the automation metrics surfaces (one source — this
 * replaced two identical per-feature copies).
 */

import { defaultLocale } from '@/lib/i18n/config';

/**
 * Format a whole-second duration as a compact `2m 30s` / `1h 5m` label.
 *
 * @param seconds - Duration in whole seconds
 * @returns Compact duration string, `"0s"` for zero/negative input
 *
 * @example
 * formatDurationSeconds(45) // "45s"
 * formatDurationSeconds(150) // "2m 30s"
 * formatDurationSeconds(3900) // "1h 5m"
 */
export function formatDurationSeconds(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) {
    return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
}

/**
 * Format a 0–100 success rate as a one-decimal percentage, or an em dash when
 * there were no runs to rate.
 *
 * @param total - Number of runs the rate is computed over
 * @param successRate - Success rate in percent (0–100)
 * @param locale - The locale to use (defaults to app default locale)
 *
 * @example
 * formatSuccessRate(120, 98.6) // "98.6%" (en)
 * formatSuccessRate(120, 98.6, 'de') // "98,6 %"
 * formatSuccessRate(0, 0) // "—"
 */
export function formatSuccessRate(
  total: number,
  successRate: number,
  locale: string = defaultLocale,
): string {
  if (total <= 0) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(successRate / 100);
  } catch {
    return `${successRate.toFixed(1)}%`;
  }
}
