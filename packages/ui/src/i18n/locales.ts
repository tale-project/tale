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
} from '@tale/i18n/locales';

import { defaultLocale } from './config';

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

export function detectInitialLocale(pathname?: string): SupportedLocale {
  if (pathname !== undefined) return localeFromPathname(pathname);
  if (typeof window === 'undefined') return defaultLocale;
  return localeFromPathname(window.location.pathname);
}

export {
  ALL_LOCALES,
  isUrlPrefixedLocale,
  localizedPath,
  REGIONAL_LOCALES,
  SUPPORTED_LOCALES,
  URL_PREFIXED_LOCALES,
};
export type { Locale, RegionalLocale, SupportedLocale, UrlPrefixedLocale };
