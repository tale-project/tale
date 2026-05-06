import type { SupportedLocale } from './locales';

/**
 * Canonical (English-default) page paths for every link target the
 * marketing site exposes. Keeping the table here — rather than in the
 * router config — gives the link helpers and the language switcher one
 * shared source of truth for which URL each canonical path resolves to
 * under each locale.
 *
 * - `en`: served at the canonical path (no prefix).
 * - `de` / `fr`: served under `/de/...` and `/fr/...` against routes
 *   defined under `routes/$lang/...`.
 */
export const LOCALIZED_ROUTE_PATHS = {
  '/': { en: '/', prefixed: '/$lang' },
  '/pricing': { en: '/pricing', prefixed: '/$lang/pricing' },
  '/contact': { en: '/contact', prefixed: '/$lang/contact' },
  '/hardware-pricing': {
    en: '/hardware-pricing',
    prefixed: '/$lang/hardware-pricing',
  },
  '/request-demo': { en: '/request-demo', prefixed: '/$lang/request-demo' },
} as const;

export type LocalizedRoutePath = keyof typeof LOCALIZED_ROUTE_PATHS;

/**
 * Build the rendered URL for a canonical path under a given locale.
 *
 * - English keeps the canonical path verbatim (`/pricing`).
 * - Prefixed locales prepend the language segment (`/de/pricing`,
 *   `/fr` for the home).
 *
 * Used for canonical metadata and anywhere we need a real string URL
 * (e.g. the language switcher's hreflang alternates) rather than going
 * through TanStack's typed `Link`.
 */
export function localizedHref(
  locale: SupportedLocale,
  path: LocalizedRoutePath,
): string {
  if (locale === 'en') return path;
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
}
