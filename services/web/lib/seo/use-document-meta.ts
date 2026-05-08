import { useDocumentMeta as useDocumentMetaBase } from '@tale/webui/seo/document-meta';

interface DocumentMeta {
  title: string;
  description: string;
  canonicalPath?: string;
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
}: DocumentMeta) {
  useDocumentMetaBase({
    title,
    description,
    canonicalPath,
    siteUrl: SITE_URL,
  });
}
