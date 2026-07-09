import { resolveHreflangFromAlternates } from '@tale/ui/seo/alternates';
import { useTaleDocumentMeta } from '@tale/ui/seo/tale-document-meta';
import { useMemo } from 'react';

import { SITE_URL } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';

interface DocumentMeta {
  title: string;
  description: string;
  /** Site-relative canonical path already localized (`/`, `/de/…`). */
  canonicalPath: string;
  /** Active page locale — drives `og:locale` and hreflang cluster. */
  locale: SupportedLocale;
  /**
   * Absolute URLs per available locale for this slug. When omitted or
   * `noindex`, no hreflang cluster is emitted.
   */
  alternates?: Partial<Record<SupportedLocale, string>>;
  noindex?: boolean;
  /** Stringified JSON-LD blocks — memoize at the call site. */
  jsonLd?: string[];
}

/**
 * Docs-site adapter around {@link useTaleDocumentMeta}. Callers pass
 * pre-localized paths and alternates; the shared OG card and `og:locale`
 * tags live in `@tale/ui/seo`.
 */
export function useDocumentMeta({
  title,
  description,
  canonicalPath,
  locale,
  alternates,
  noindex,
  jsonLd,
}: DocumentMeta) {
  const { t } = useT('seo');

  const { hreflang, alternateLocales } = useMemo(
    () => resolveHreflangFromAlternates(locale, alternates, noindex),
    [alternates, locale, noindex],
  );

  useTaleDocumentMeta({
    title,
    description,
    canonicalPath,
    siteUrl: SITE_URL,
    locale,
    alternateLocales,
    ogImageAlt: t('ogImageAlt'),
    noindex,
    hreflang,
    jsonLd,
  });
}
