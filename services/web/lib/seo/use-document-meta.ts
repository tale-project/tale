import { buildLocaleAlternateUrls } from '@tale/ui/seo/alternates';
import { TALE_SITE_URL } from '@tale/ui/seo/globals';
import { useTaleDocumentMeta } from '@tale/ui/seo/tale-document-meta';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import {
  localizedPath,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@/lib/i18n/locales';
import { useCurrentLocale } from '@/lib/i18n/use-current-locale';

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
 * Marketing-site adapter around {@link useTaleDocumentMeta}. Derives
 * per-locale canonical + hreflang from the unlocalized route path; the
 * shared OG card and `og:locale` tags live in `@tale/ui/seo`.
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
  const hreflang = useMemo(() => {
    if (path === undefined || noindex) return undefined;
    const alternates = buildLocaleAlternateUrls(
      TALE_SITE_URL,
      SUPPORTED_LOCALES,
      (pageLocale) => localizedPath(pageLocale as SupportedLocale, path),
    ) as Partial<Record<SupportedLocale, string>>;
    return { locale, alternates };
  }, [locale, noindex, path]);

  const alternateLocales = useMemo(
    () => (path === undefined || noindex ? undefined : SUPPORTED_LOCALES),
    [noindex, path],
  );

  useTaleDocumentMeta({
    title,
    description,
    canonicalPath: resolvedCanonical,
    siteUrl: TALE_SITE_URL,
    locale,
    alternateLocales,
    ogImageAlt: t('ogImageAlt'),
    noindex,
    hreflang,
    jsonLd,
  });
}
