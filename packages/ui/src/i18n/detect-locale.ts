// Client-side locale detection helpers. Pure types live in `./locales`;
// this file adds runtime helpers that read `navigator.language` and
// `window.location` so they only make sense in a browser context.

import { defaultLocale } from './config';
import {
  ALL_LOCALES,
  isUrlPrefixedLocale,
  localizedPath,
  REGIONAL_LOCALES,
  SUPPORTED_LOCALES,
  URL_PREFIXED_LOCALES,
  type Locale,
  type RegionalLocale,
  type SupportedLocale,
  type UrlPrefixedLocale,
} from './locales';

// Re-export the base locale model so the React-aware helpers below can
// be the single import site for client code that also needs `Locale`,
// `SupportedLocale`, etc.
export {
  ALL_LOCALES,
  isUrlPrefixedLocale,
  localizedPath,
  REGIONAL_LOCALES,
  SUPPORTED_LOCALES,
  URL_PREFIXED_LOCALES,
};
export type { Locale, RegionalLocale, SupportedLocale, UrlPrefixedLocale };

const REGIONAL_OVERRIDES: ReadonlySet<RegionalLocale> = new Set(
  REGIONAL_LOCALES,
);

function isRegionalLocale(value: string): value is RegionalLocale {
  return (REGIONAL_OVERRIDES as ReadonlySet<string>).has(value);
}

function getBrowserRegion(): string | null {
  if (typeof navigator === 'undefined') return null;
  const tag = navigator.language;
  if (typeof tag !== 'string') return null;
  const dash = tag.indexOf('-');
  return dash >= 0 ? tag.slice(dash + 1).toUpperCase() : null;
}

/**
 * Resolve a base locale to its regional variant when the browser
 * advertises one (e.g. `de` → `de-CH`). Falls back to the base locale
 * when no variant matches or when running outside the browser.
 */
export function resolveRegionalLocale(
  base: SupportedLocale,
): SupportedLocale | RegionalLocale {
  const region = getBrowserRegion();
  if (!region) return base;
  const candidate = `${base}-${region}`;
  return isRegionalLocale(candidate) ? candidate : base;
}

function localeFromPathname(pathname: string): SupportedLocale {
  const segment = pathname.split('/').find((s) => s.length > 0);
  if (segment !== undefined && isUrlPrefixedLocale(segment)) {
    return segment;
  }
  return defaultLocale;
}

/**
 * Pull the locale from a URL pathname. When called without a pathname,
 * reads `window.location.pathname` (returns `defaultLocale` during
 * SSR).
 */
export function detectInitialLocale(pathname?: string): SupportedLocale {
  if (pathname !== undefined) return localeFromPathname(pathname);
  if (typeof window === 'undefined') return defaultLocale;
  return localeFromPathname(window.location.pathname);
}
