import { useDocumentMeta as useDocumentMetaBase } from '@tale/webui/seo/document-meta';

interface DocumentMeta {
  title: string;
  description: string;
  canonicalPath?: string;
  /**
   * When true, emits `<meta name="robots" content="noindex,nofollow">`.
   * Legal pages set `noindex: true` in their YAML frontmatter; pre-fix
   * this wrapper didn't accept the flag, so legal docs shipped indexable.
   * Round-2 review CRITICAL #26 / F.1.
   */
  noindex?: boolean;
}

const SITE_URL = 'https://tale.dev';

/**
 * Marketing-site wrapper around the shared `useDocumentMeta` hook.
 * Pre-binds the canonical site origin so legal pages and marketing
 * routes only need to pass the page-specific title/description/path.
 */
export function useDocumentMeta({
  title,
  description,
  canonicalPath,
  noindex,
}: DocumentMeta) {
  useDocumentMetaBase({
    title,
    description,
    canonicalPath,
    siteUrl: SITE_URL,
    noindex,
  });
}
