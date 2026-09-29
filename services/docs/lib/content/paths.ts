import { absoluteSitePath } from '@tale/ui/seo/urls';

import type { SupportedLocale } from '@/lib/i18n/locales';

// Relative, not `@/`: the Bun-run server and prerender script import this
// module, and Bun does not resolve the root tsconfig's `${configDir}` paths.
import { DEFAULT_DOCS_SITE_URL } from '../site-url';

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
  return DEFAULT_DOCS_SITE_URL;
}

const SITE_URL = resolveSiteUrl();

/**
 * A slug's locale-less route: `foo/index` and `foo` serve the same URL, and
 * the root `index` is the empty route.
 */
export function slugRoute(slug: string): string {
  return slug === 'index' ? '' : slug.replace(/\/index$/, '');
}

/** Path on the docs host for a given (locale, slug). */
export function docPath(locale: SupportedLocale, slug: string): string {
  const cleaned = slugRoute(slug);
  if (locale === 'en') return cleaned ? `/${cleaned}` : '/';
  return cleaned ? `/${locale}/${cleaned}` : `/${locale}`;
}

export function docUrl(locale: SupportedLocale, slug: string): string {
  return absoluteSitePath(SITE_URL, docPath(locale, slug));
}

function docMarkdownPath(locale: SupportedLocale, slug: string): string {
  const path = docPath(locale, slug);
  return path === '/' ? '/index.md' : `${path}.md`;
}

export function docMarkdownUrl(locale: SupportedLocale, slug: string): string {
  return absoluteSitePath(SITE_URL, docMarkdownPath(locale, slug));
}

export { SITE_URL };
