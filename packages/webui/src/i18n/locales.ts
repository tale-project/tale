import { defaultLocale } from './config';

/**
 * Cross-app locale model. Both `services/web` and `services/docs` render in
 * the same three base locales (English at the canonical path, German and
 * French at `/de/...` / `/fr/...`) plus three regional variants resolved
 * client-side (`de-AT`, `de-CH`, `fr-CH`). Regional variants never appear
 * in URLs — they only override message bundles when the browser advertises
 * the matching region.
 */

const SUPPORTED_LOCALES = ['en', 'de', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const URL_PREFIXED_LOCALES = ['de', 'fr'] as const;
type UrlPrefixedLocale = (typeof URL_PREFIXED_LOCALES)[number];

const URL_PREFIXED_SET: ReadonlySet<string> = new Set(URL_PREFIXED_LOCALES);

export function isUrlPrefixedLocale(value: string): value is UrlPrefixedLocale {
  return URL_PREFIXED_SET.has(value);
}

export const REGIONAL_LOCALES = ['de-CH', 'de-AT', 'fr-CH'] as const;
export type RegionalLocale = (typeof REGIONAL_LOCALES)[number];

const REGIONAL_OVERRIDES: ReadonlySet<string> = new Set(REGIONAL_LOCALES);

export const ALL_LOCALES = [...SUPPORTED_LOCALES, ...REGIONAL_LOCALES] as const;
export type Locale = (typeof ALL_LOCALES)[number];

function getBrowserRegion(): string | null {
  if (typeof navigator === 'undefined') return null;
  const tag = navigator.language;
  if (typeof tag !== 'string') return null;
  const dash = tag.indexOf('-');
  return dash >= 0 ? tag.slice(dash + 1).toUpperCase() : null;
}

export function resolveRegionalLocale(base: SupportedLocale): string {
  const region = getBrowserRegion();
  if (!region) return base;
  const candidate = `${base}-${region}`;
  return REGIONAL_OVERRIDES.has(candidate) ? candidate : base;
}

function localeFromPathname(pathname: string): SupportedLocale {
  const segment = pathname.split('/').find((s) => s.length > 0);
  if (segment !== undefined && isUrlPrefixedLocale(segment)) {
    return segment;
  }
  return defaultLocale;
}

export function detectInitialLocale(pathname?: string): SupportedLocale {
  if (pathname !== undefined) return localeFromPathname(pathname);
  if (typeof window === 'undefined') return defaultLocale;
  return localeFromPathname(window.location.pathname);
}
