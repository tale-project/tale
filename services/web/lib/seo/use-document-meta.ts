import { useDocumentMeta as useDocumentMetaBase } from '@tale/ui/seo/document-meta';
import { TALE_SITE_URL } from '@tale/ui/seo/globals';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import { localizedPath, type SupportedLocale } from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

/** URL-bearing marketing locales (en unprefixed; de-CH is an i18n overlay only). */
const PAGE_LOCALES = ['en', 'de', 'fr'] as const;

/** OpenGraph territory tags per page locale — German copy is Swiss-spelled. */
const OG_LOCALES: Record<string, string> = {
  en: 'en_US',
  de: 'de_CH',
  fr: 'fr_CH',
};

/** Brand card served for every page; see scripts/make-og-image.ts. */
const OG_IMAGE = {
  path: '/og.png',
  width: 1200,
  height: 630,
  type: 'image/png',
} as const;

interface DocumentMeta {
  title: string;
  description: string;
  /**
   * Unlocalized route path (`'/'`, `'/pricing'`). Canonical, the full
   * hreflang cluster (en/de/fr + x-default), and og:locale all derive from
   * it for the current locale.
   */
  path?: string;
  /**
   * Pre-localized canonical path for pages outside the locale-parallel
   * tree (legal markdown). No hreflang cluster is emitted.
   */
  canonicalPath?: string;
  /**
   * When true, emits `<meta name="robots" content="noindex,nofollow">`
   * and skips the hreflang cluster (noindex pages must not advertise
   * alternates).
   */
  noindex?: boolean;
  /**
   * Stringified JSON-LD blocks. Memoize at the call site — the array
   * identity feeds the head effect (see docs-page.tsx for the pattern).
   */
  jsonLd?: string[];
}

/**
 * Marketing-site wrapper around the shared `useDocumentMeta` hook.
 * Pre-binds the canonical site origin and the sitewide OpenGraph payload
 * (brand card, locale tags), and derives per-locale canonical + hreflang
 * from the unlocalized route path so pages declare their meta once.
 */
export function useDocumentMeta({
  title,
  description,
  path,
  canonicalPath,
  noindex,
  jsonLd,
}: DocumentMeta) {
  const locale = useCurrentLocale();
  const { t } = useT('seo');

  const resolvedCanonical =
    path === undefined ? canonicalPath : localizedPath(locale, path);

  // Object identities feed the head effect's deps — derive them per
  // (locale, path), not per render.
  const hreflang = useMemo<
    Parameters<typeof useDocumentMetaBase>[0]['hreflang']
  >(() => {
    if (path === undefined || noindex) return undefined;
    const alternates: Partial<Record<SupportedLocale, string>> = {};
    for (const pageLocale of PAGE_LOCALES) {
      alternates[pageLocale] =
        `${TALE_SITE_URL}${localizedPath(pageLocale, path)}`;
    }
    return { locale, alternates };
  }, [locale, noindex, path]);

  const ogLocaleAlternates = useMemo(
    () =>
      PAGE_LOCALES.filter((pageLocale) => pageLocale !== locale).map(
        (pageLocale) => OG_LOCALES[pageLocale],
      ),
    [locale],
  );

  useDocumentMetaBase({
    title,
    description,
    canonicalPath: resolvedCanonical,
    siteUrl: TALE_SITE_URL,
    noindex,
    defaultOgImage: `${TALE_SITE_URL}${OG_IMAGE.path}`,
    ogImageAlt: t('ogImageAlt'),
    ogImageWidth: OG_IMAGE.width,
    ogImageHeight: OG_IMAGE.height,
    ogImageType: OG_IMAGE.type,
    ogLocale: OG_LOCALES[locale] ?? OG_LOCALES.en,
    ogLocaleAlternates,
    hreflang,
    jsonLd,
  });
}
