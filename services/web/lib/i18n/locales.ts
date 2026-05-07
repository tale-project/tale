import { defaultLocale } from './config';

/**
 * Marketing site locale model.
 *
 * The site renders in three base locales: English (the default, served at
 * the root path with no prefix) and German + French (served under
 * `/de/...` and `/fr/...` prefixes). Regional variants (`de-CH`, `de-AT`,
 * `fr-CH`) are resolved at the i18n layer when content benefits from
 * region-specific overrides — they never appear in URLs.
 *
 * Keeping prefixed and unprefixed locales in separate constants lets the
 * router and link helpers share the same source of truth without leaking
 * `'en'` into URL-construction code (where it must be omitted).
 */

const SUPPORTED_LOCALES = ['en', 'de', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const URL_PREFIXED_LOCALES = ['de', 'fr'] as const;
type UrlPrefixedLocale = (typeof URL_PREFIXED_LOCALES)[number];

const URL_PREFIXED_SET: ReadonlySet<string> = new Set(URL_PREFIXED_LOCALES);

export function isUrlPrefixedLocale(value: string): value is UrlPrefixedLocale {
  return URL_PREFIXED_SET.has(value);
}

const REGIONAL_OVERRIDES: ReadonlySet<string> = new Set([
  'de-CH',
  'de-AT',
  'fr-CH',
]);

function getBrowserRegion(): string | null {
  if (typeof navigator === 'undefined') return null;
  const tag = navigator.language;
  if (typeof tag !== 'string') return null;
  const dash = tag.indexOf('-');
  return dash >= 0 ? tag.slice(dash + 1).toUpperCase() : null;
}

/**
 * Pick the most specific i18n bundle for a given base locale, layering on
 * a regional variant when the browser advertises one we have copy for
 * (e.g. user picks German on a Swiss browser → `de-CH`).
 *
 * Always returns the base locale on the server, where `navigator` is
 * unavailable; the client-side effect re-runs on hydration to pick up the
 * region.
 */
export function resolveRegionalLocale(base: SupportedLocale): string {
  const region = getBrowserRegion();
  if (!region) return base;
  const candidate = `${base}-${region}`;
  return REGIONAL_OVERRIDES.has(candidate) ? candidate : base;
}

/**
 * Reads a URL pathname and returns the base locale it declares —
 * `de`/`fr` for the prefixed routes, `en` otherwise.
 */
function localeFromPathname(pathname: string): SupportedLocale {
  const segment = pathname.split('/').find((s) => s.length > 0);
  if (segment !== undefined && isUrlPrefixedLocale(segment)) {
    return segment;
  }
  return defaultLocale;
}

/**
 * Picks the locale to seed `i18n.changeLanguage` with on the very first
 * render, avoiding a flash of the wrong language before the
 * router-driven sync effect runs. On the server, the URL must be passed
 * explicitly (there's no `window`); on the client we fall back to
 * `window.location.pathname`.
 */
export function detectInitialLocale(pathname?: string): SupportedLocale {
  if (pathname !== undefined) return localeFromPathname(pathname);
  if (typeof window === 'undefined') return defaultLocale;
  return localeFromPathname(window.location.pathname);
}
