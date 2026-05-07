import type { SupportedLocale } from '@/lib/i18n/locales';

// Vite replaces `import.meta.env.VITE_DOCS_SITE_URL` at build time so the
// constant is available in the browser. Build scripts (Node/Bun) override
// it via `DOCS_SITE_URL`. Falls back to the public docs origin.
function resolveSiteUrl(): string {
  if (typeof import.meta !== 'undefined') {
    const fromVite = import.meta.env?.VITE_DOCS_SITE_URL;
    if (typeof fromVite === 'string' && fromVite.length > 0) return fromVite;
  }
  if (typeof process !== 'undefined') {
    const fromNode = process.env?.DOCS_SITE_URL;
    if (typeof fromNode === 'string' && fromNode.length > 0) return fromNode;
  }
  return 'https://docs.tale.dev';
}

const SITE_URL = resolveSiteUrl();

/** Path on the docs host for a given (locale, slug). */
export function docPath(locale: SupportedLocale, slug: string): string {
  const cleaned = slug === 'index' ? '' : slug.replace(/\/index$/, '');
  if (locale === 'en') return cleaned ? `/${cleaned}` : '/';
  return cleaned ? `/${locale}/${cleaned}` : `/${locale}`;
}

export function docUrl(locale: SupportedLocale, slug: string): string {
  return `${SITE_URL}${docPath(locale, slug)}`;
}

export function docMarkdownPath(locale: SupportedLocale, slug: string): string {
  const path = docPath(locale, slug);
  return path === '/' ? '/index.md' : `${path}.md`;
}

export function docMarkdownUrl(locale: SupportedLocale, slug: string): string {
  return `${SITE_URL}${docMarkdownPath(locale, slug)}`;
}

export { SITE_URL };
