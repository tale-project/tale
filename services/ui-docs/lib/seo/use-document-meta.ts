import { useTaleDocumentMeta } from '@tale/ui/seo/tale-document-meta';

import { SITE_URL } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';

interface DocumentMeta {
  title: string;
  description: string;
  /** Site-relative canonical path (`/`, `/docs/components/button`). */
  canonicalPath: string;
  noindex?: boolean;
  /** Stringified JSON-LD blocks — memoize at the call site. */
  jsonLd?: string[];
}

/**
 * Adapter around {@link useTaleDocumentMeta} for this site. English-only, so
 * there is no hreflang cluster and no alternate set to resolve — the locale
 * is always `en`.
 */
export function useDocumentMeta({
  title,
  description,
  canonicalPath,
  noindex,
  jsonLd,
}: DocumentMeta) {
  const { t } = useT('seo');

  useTaleDocumentMeta({
    title,
    description,
    canonicalPath,
    siteUrl: SITE_URL,
    locale: 'en',
    ogImageAlt: t('ogImageAlt'),
    noindex,
    jsonLd,
  });
}
