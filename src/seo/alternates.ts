/**
 * Hreflang / sitemap alternate URL helpers shared by the marketing site
 * and the docs site. Both used to hand-roll the same locale → absolute URL
 * map (and `x-default`); this module is the single source of truth.
 */

import { isCookieLocale, type SupportedLocale } from '@tale/ui/i18n/locales';

import type { DocumentHeadInput } from './head-tags';
import type { Alternates } from './types';
import { absoluteSitePath } from './urls';

/**
 * Build absolute per-locale URLs for one logical page. `pathForLocale`
 * returns the site-relative path for that locale, or `null`/`undefined`
 * when the page does not exist in that locale (skipped).
 */
export function buildLocaleAlternateUrls(
  siteUrl: string,
  locales: readonly string[],
  pathForLocale: (locale: string) => string | null | undefined,
): Record<string, string> {
  const alternates: Record<string, string> = {};
  for (const locale of locales) {
    const path = pathForLocale(locale);
    if (path == null || path === '') continue;
    alternates[locale] = absoluteSitePath(siteUrl, path);
  }
  return alternates;
}

/**
 * Attach sitemap `x-default` pointing at the English URL when present.
 * HTML head hreflang gets `x-default` from {@link resolveDocumentHead}
 * separately — call this for sitemap / artifact `Alternates` only.
 */
export function withXDefault(alternates: Record<string, string>): Alternates {
  if (alternates.en) {
    return { ...alternates, 'x-default': alternates.en };
  }
  return alternates;
}

/**
 * Turn a pre-built absolute-URL alternates map into the inputs
 * {@link useTaleDocumentMeta} expects. Shared by the docs adapter (and
 * any future caller that already has absolute alternates).
 */
export function resolveHreflangFromAlternates(
  locale: SupportedLocale,
  alternates: Partial<Record<SupportedLocale, string>> | undefined,
  noindex?: boolean,
): {
  hreflang?: DocumentHeadInput['hreflang'];
  alternateLocales?: SupportedLocale[];
} {
  if (noindex || !alternates || Object.keys(alternates).length === 0) {
    return {};
  }
  return {
    hreflang: { locale, alternates },
    alternateLocales: Object.keys(alternates).filter(isCookieLocale),
  };
}
