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
 * Format a duration in milliseconds
 *
 * @param ms - Duration in milliseconds
 * @param locale - The locale to use (defaults to app default locale)
 * @returns Formatted duration string with "ms" suffix
 *
 * @example
 * formatDuration(1234) // "1,234 ms" (en)
 * formatDuration(1234, 'de') // "1.234 ms"
 */
export function formatDuration(
  ms: number,
  locale: string = defaultLocale,
): string {
  return `${formatNumber(ms, locale)} ms`;
}

/**
 * Format bytes to human-readable size
 *
 * @param bytes - Number of bytes
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
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);

  return `${formatNumber(size, locale, { maximumFractionDigits: decimals })} ${sizes[i]}`;
}
