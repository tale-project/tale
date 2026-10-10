// Client-side locale detection helpers. Pure types live in `./locales`;
// this file adds runtime helpers that read `navigator.language` and
// `window.location` so they only make sense in a browser context.

import { parseAcceptLanguage } from './accept-language';
import { defaultLocale } from './config';
import { isValidLocale } from './is-valid-locale';
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
import { resolveLocale } from './resolve-locale';

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

// Optional global injected by SSR-aware services (platform's `server.ts`
// rewrites a placeholder in `index.html` with the request's
// `Accept-Language` header). Declared here so the detection can read it
// without `any`; merges with platform's identical declaration in
// `services/platform/lib/env.ts` and is harmless for services that don't
// inject it (the read just returns `undefined`).
declare global {
  interface Window {
    __ACCEPT_LANGUAGE__?: string;
  }
}

/** Where `LocaleProvider` keeps the locale a person picked. */
export const LOCALE_STORAGE_KEY = 'user-locale';

/**
 * The locale a service that follows the person's preference runs in: the one
 * they picked (localStorage), else the request's `Accept-Language` the server
 * injected, else the browser's languages. `LocaleProvider` starts from it,
 * and a service that fetches languages on first use reads it to load and
 * switch to the right one before its first frame.
 */
export function detectPreferredLocale(fallback = 'en-US'): string {
  // Outside a browser (a server render, a test under Node) there is no
  // person to ask.
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return fallback;
  }
  const savedLocale = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (savedLocale && isValidLocale(savedLocale)) return savedLocale;

  const serverHeader = window.__ACCEPT_LANGUAGE__;
  if (serverHeader) {
    return resolveLocale(parseAcceptLanguage(serverHeader), fallback);
  }

  return resolveLocale(navigator.languages ?? [navigator.language], fallback);
}
