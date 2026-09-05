/**
 * Number Formatting Utilities
 *
 * Centralized number, currency, and duration formatting with locale support.
 * Uses Intl.NumberFormat for proper localization.
 */

import { defaultLocale } from '@/lib/i18n/config';

/**
 * Format a number with locale-aware thousand separators
 *
 * @param value - The number to format
 * @param locale - The locale to use (defaults to app default locale)
 * @param options - Additional Intl.NumberFormat options
 * @returns Formatted number string
 *
 * @example
 * formatNumber(1234567) // "1,234,567" (en)
 * formatNumber(1234567, 'de') // "1.234.567"
 */
export function formatNumber(
  value: number,
  locale: string = defaultLocale,
  options?: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    return value.toString();
  }
}

/**
 * Format a number as currency
 *
 * @param value - The monetary value to format
 * @param currency - ISO 4217 currency code (e.g., 'USD', 'EUR')
 * @param locale - The locale to use (defaults to app default locale)
 * @returns Formatted currency string
 *
 * @example
 * formatCurrency(1234.56, 'USD') // "$1,234.56" (en)
 * formatCurrency(1234.56, 'EUR', 'de') // "1.234,56 €"
 */
export function formatCurrency(
  value: number,
  currency: string,
  locale: string = defaultLocale,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
    }).format(value);
  } catch {
    // Fallback if currency code is invalid
    return `${currency} ${formatNumber(value, locale)}`;
  }
}

/**
 * Format a cost in cents as locale-aware currency.
 *
 * Small values (< $1) fall back to 3 significant digits so micro-costs
 * like $0.00068 remain readable; $0 stays as a clean "$0.00".
 *
 * @param cents - Cost in integer cents
 * @param currency - ISO 4217 currency code (default 'USD')
 * @param locale - The locale to use (defaults to app default locale)
 *
 * @example
 * formatCostCents(0)      // "$0.00"
 * formatCostCents(1234)   // "$12.34"
 * formatCostCents(12)     // "$0.12"
 * formatCostCents(1)      // "$0.0100" (3 sig figs)
 */
export function formatCostCents(
  cents: number,
  currency: string = 'USD',
  locale: string = defaultLocale,
): string {
  const value = cents / 100;
  if (value === 0 || Math.abs(value) >= 1) {
    return formatCurrency(value, currency, locale);
  }
  // Small values — preserve 3 significant digits.
  const digits = Math.max(
    2,
    2 - Math.floor(Math.log10(Math.abs(value))) - 1 + 2,
  );
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: Math.min(digits, 10),
    }).format(value);
  } catch {
    return `${currency} ${value.toPrecision(3)}`;
  }
}

/**
 * Format a part-of-total share as a percentage, or an em dash when there is
 * no total to share (0/0 is "no data", not "0%"). The single home for the
 * sentiment/positive-share rendering used across the metrics tables.
 *
 * @param part - The counted subset (e.g. positive ratings)
 * @param total - The whole (e.g. all ratings)
 * @param locale - The locale to use (defaults to app default locale)
 *
 * @example
 * formatPercentShare(3, 4) // "75%" (en)
 * formatPercentShare(1, 3, 'de') // "33,3 %"
 * formatPercentShare(0, 0) // "—"
 */
export function formatPercentShare(
  part: number,
  total: number,
  locale: string = defaultLocale,
): string {
  if (total === 0) return '—';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(part / total);
  } catch {
    return `${Math.round((part / total) * 100)}%`;
  }
}

/**
 * Format bytes to human-readable size — THE byte formatter every surface
 * uses, so a file's size reads the same in every dialog and list.
 *
 * @param bytes - Number of bytes; a non-finite or negative value has no
 *   size to show and renders as an em dash (no data, not 0 B)
 * @param locale - The locale to use (defaults to app default locale)
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted size string with appropriate unit
 *
 * @example
 * formatBytes(1536) // "1.5 KB" (en)
 * formatBytes(1073741824) // "1 GB"
 */
export function formatBytes(
  bytes: number,
  locale: string = defaultLocale,
  decimals: number = 1,
): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  // Clamped: beyond the largest unit the number grows instead of the unit
  // vanishing into `undefined`.
  const i = Math.min(
    sizes.length - 1,
    Math.floor(Math.log(bytes) / Math.log(k)),
  );
  const size = bytes / Math.pow(k, i);

  return `${formatNumber(size, locale, { maximumFractionDigits: decimals })} ${sizes[i]}`;
}
