/**
 * Cross-service locale model. Both `services/web` and `services/docs` render in
 * the same three base locales (English at the canonical path, German and
 * French at `/de/...` / `/fr/...`) plus zero or more regional variants
 * resolved client-side (e.g. `de-CH`). Regional variants never appear in
 * URLs — they only override message bundles when the browser advertises a
 * matching region. Add a new variant by listing it in `REGIONAL_LOCALES`
 * and dropping a `<locale>.json` file in each app's `messages/`.
 */

const SUPPORTED_LOCALES = ['en', 'de', 'fr'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const URL_PREFIXED_LOCALES = ['de', 'fr'] as const;
export type UrlPrefixedLocale = (typeof URL_PREFIXED_LOCALES)[number];

const URL_PREFIXED_SET: ReadonlySet<string> = new Set(URL_PREFIXED_LOCALES);

export function isUrlPrefixedLocale(value: string): value is UrlPrefixedLocale {
  return URL_PREFIXED_SET.has(value);
}

export const REGIONAL_LOCALES = ['de-CH'] as const;
export type RegionalLocale = (typeof REGIONAL_LOCALES)[number];

export const ALL_LOCALES = [...SUPPORTED_LOCALES, ...REGIONAL_LOCALES] as const;
export type Locale = (typeof ALL_LOCALES)[number];

/** All locales that may legitimately appear as a `tale_locale` cookie value
 *  on the marketing/docs sites. URL-prefixed locales plus the canonical
 *  default ('en'). Anything else is ignored and re-detected. */
const COOKIE_LOCALES_SET: ReadonlySet<string> = new Set<string>([
  'en',
  ...URL_PREFIXED_LOCALES,
]);

export function isCookieLocale(value: string): value is SupportedLocale {
  return COOKIE_LOCALES_SET.has(value);
}

/**
 * Builds the rendered URL for a canonical (English-default) path under the
 * given locale. English keeps the canonical path verbatim; URL-prefixed
 * locales (`de`, `fr`) prepend the language segment. Used by client-side
 * link helpers to render the right URL without hardcoding the prefix rule
 * at every callsite.
 *
 * @example
 * localizedPath('en', '/pricing')  // '/pricing'
 * localizedPath('de', '/pricing')  // '/de/pricing'
 * localizedPath('fr', '/')         // '/fr'
 */
export function localizedPath(
  locale: SupportedLocale,
  pathname: string,
): string {
  // Normalize root first so callers passing `''` get a valid `/` for English
  // and `/de` / `/fr` for the prefixed locales (instead of an empty string).
  if (pathname === '/' || pathname === '') {
    return locale === 'en' ? '/' : `/${locale}`;
  }
  if (locale === 'en') return pathname;
  return `/${locale}${pathname}`;
}

export { SUPPORTED_LOCALES, URL_PREFIXED_LOCALES };
