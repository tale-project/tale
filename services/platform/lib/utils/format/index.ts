/**
 * Format Utilities
 *
 * Centralized formatting utilities for numbers, currencies, durations, and more.
 * All formatters support locale-aware formatting using Intl APIs.
 *
 * @example
 * ```tsx
 * import { formatNumber, formatCurrency, formatDuration } from '@/lib/utils/format';
 *
 * // In a component with useLocale hook
 * const locale = useLocale();
 *
 * formatNumber(1234567, locale) // "1,234,567"
 * formatCurrency(99.99, 'USD', locale) // "$99.99"
 * formatDuration(1500, locale) // "1,500 ms"
 * ```
 */

export {
  formatNumber,
  formatCurrency,
  formatDuration,
  formatPercentage,
  formatCompact,
  formatBytes,
} from './number';
