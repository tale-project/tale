// Locale-aware number, currency, and date formatting wrappers around the
// ECMA-402 `Intl` API. We don't pull in a third-party currency library
// because `Intl.NumberFormat` already covers the formats we ship: ISO
// currency codes, Swiss apostrophe grouping (`CHF 1'199`), compact notation
// (`CHF 2K`), and per-locale decimal/group separators.

export interface FormatNumberOptions {
  locale?: string | string[];
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  useGrouping?: boolean;
  notation?: 'standard' | 'scientific' | 'engineering' | 'compact';
  compactDisplay?: 'short' | 'long';
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'negative' | 'never';
}

export interface FormatCurrencyOptions extends FormatNumberOptions {
  currency: string;
  /**
   * `'symbol'` → `CHF 1'199` (default; ISO code rendered as a symbol in most
   * locales). `'narrowSymbol'` collapses to `$` where available.
   * `'code'` always renders the ISO code (`CHF`). `'name'` renders
   * `Swiss francs`.
   */
  currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name';
  /** Lowercase the compact suffix (`2K` → `2k`) when `notation === 'compact'`. */
  lowercaseCompact?: boolean;
  /**
   * Render as an approximate value, e.g. `CHF ~2.1k`. Implies compact
   * notation and lowercased compact suffix; the prefix defaults to `'~'`
   * and can be overridden via `approximationPrefix`.
   */
  approximate?: boolean;
  /** Prefix inserted before the digits when `approximate` is true. */
  approximationPrefix?: string;
}

const DEFAULT_LOCALE = 'en-US';

function resolveLocale(
  locale: FormatNumberOptions['locale'],
): string | string[] {
  return locale ?? DEFAULT_LOCALE;
}

/**
 * Format a number using the user's locale conventions.
 *
 * @example
 * formatNumber(1199, { locale: 'de-CH' })
 * // => "1’199"
 */
export function formatNumber(
  value: number,
  options: FormatNumberOptions = {},
): string {
  const { locale, ...rest } = options;
  return new Intl.NumberFormat(resolveLocale(locale), rest).format(value);
}

/**
 * Format a monetary amount with its ISO currency code or symbol.
 *
 * @example
 * formatCurrency(299, { currency: 'CHF', locale: 'en-US' })
 * // => "CHF 299.00"
 *
 * formatCurrency(1199, { currency: 'CHF', locale: 'de-CH', maximumFractionDigits: 0 })
 * // => "CHF 1’199"
 */
export function formatCurrency(
  value: number,
  options: FormatCurrencyOptions,
): string {
  const {
    locale,
    currency,
    currencyDisplay = 'code',
    lowercaseCompact = false,
    notation,
    approximate = false,
    approximationPrefix = '~',
    ...rest
  } = options;

  const effectiveNotation = approximate ? 'compact' : notation;
  const compactDefaults = approximate
    ? {
        compactDisplay: 'short' as const,
        minimumFractionDigits: 0,
        maximumFractionDigits: 1,
      }
    : {};

  const formatted = new Intl.NumberFormat(resolveLocale(locale), {
    style: 'currency',
    currency,
    currencyDisplay,
    notation: effectiveNotation,
    ...compactDefaults,
    ...rest,
  }).format(value);

  const shouldLowercaseCompact =
    (lowercaseCompact || approximate) && effectiveNotation === 'compact';
  const lowercased = shouldLowercaseCompact
    ? formatted.replace(/([0-9])([KMGBT])\b/g, (_, digit, suffix) => {
        const map: Record<string, string> = {
          K: 'k',
          M: 'M',
          G: 'G',
          B: 'B',
          T: 'T',
        };
        return `${digit}${map[suffix] ?? suffix}`;
      })
    : formatted;

  if (approximate) {
    // Insert the prefix between the currency token and the digits, regardless
    // of whether the locale renders it as a symbol or as an ISO code.
    return lowercased.replace(/(\p{N})/u, `${approximationPrefix}$1`);
  }

  return lowercased;
}

/**
 * Format a monetary amount in compact notation (`CHF 2k`, `$1.2M`).
 * Marketing pages use this for "from"-style price callouts.
 *
 * @example
 * formatCompactCurrency(2000, { currency: 'CHF' })
 * // => "CHF 2k"
 */
export function formatCompactCurrency(
  value: number,
  options: Omit<FormatCurrencyOptions, 'notation'>,
): string {
  return formatCurrency(value, {
    notation: 'compact',
    compactDisplay: 'short',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
    lowercaseCompact: true,
    ...options,
  });
}
