import type { SupportedLocale } from '@/lib/i18n/locales';

export type Region = 'CH' | 'DE';

export const REGIONS = ['CH', 'DE'] as const;

export const REGION_CURRENCY: Record<Region, 'CHF' | 'EUR'> = {
  CH: 'CHF',
  DE: 'EUR',
};

/**
 * Locale that formats pricing numbers: the region picks the currency
 * (`REGION_CURRENCY`), the page language picks the separators. CHF amounts
 * use the Swiss variant of the page language; EUR amounts use the page
 * language itself, because `en-DE` groups counts with `.` (`1.000`) but
 * amounts with `,` (`EUR 1,000`).
 */
export const REGION_NUMBER_LOCALE: Record<
  Region,
  Record<SupportedLocale, string>
> = {
  CH: { en: 'en-CH', de: 'de-CH', fr: 'fr-CH' },
  DE: { en: 'en', de: 'de', fr: 'fr' },
};

export function detectDefaultRegion(): Region {
  if (typeof navigator === 'undefined') return 'CH';
  const tag = navigator.language ?? '';
  const region = tag.split('-')[1]?.toUpperCase();
  if (region === 'CH') return 'CH';
  if (region === 'DE' || region === 'AT') return 'DE';
  return 'CH';
}
