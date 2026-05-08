import { createFileRoute, notFound } from '@tanstack/react-router';

import { DocsPage } from '@/app/pages/docs-page';
import { NotFoundPage } from '@/app/pages/not-found-page';
import { getDocPage } from '@/lib/content/loader';
import { isUrlPrefixedLocale, type SupportedLocale } from '@/lib/i18n/locales';

interface Resolved {
  locale: SupportedLocale;
  slug: string;
}

/**
 * Read the active locale and the on-disk slug out of the splat. The first
 * URL segment may be a URL-prefixed locale (`de`, `fr`); everything after
 * that is the slug. `'index'` substitutes for an empty slug so the loader
 * can resolve the locale's landing page.
 */
function resolve(splat: string): Resolved {
  const parts = splat.split('/').filter(Boolean);
  let locale: SupportedLocale = 'en';
  if (parts.length > 0 && isUrlPrefixedLocale(parts[0])) {
    locale = parts[0];
    parts.shift();
  }
  const slug = parts.length === 0 ? 'index' : parts.join('/');
  return { locale, slug };
}

function isSpecialEndpoint(splat: string): boolean {
  return (
    splat.endsWith('.md') ||
    splat === 'llms.txt' ||
    splat === 'llms-full.txt' ||
    splat === 'sitemap.xml' ||
    splat === 'robots.txt'
  );
}

function SplatRoute() {
  const params = Route.useParams() as { _splat?: string };
  const splat = params._splat ?? '';
  const { locale, slug } = resolve(splat);
  return <DocsPage locale={locale} slug={slug} />;
}

function SplatNotFound() {
  const params = Route.useParams() as { _splat?: string };
  const { locale } = resolve(params._splat ?? '');
  return <NotFoundPage locale={locale} />;
}

export const Route = createFileRoute('/$')({
  beforeLoad: ({ params }) => {
    const splat = params._splat ?? '';
    if (isSpecialEndpoint(splat)) return;
    const { locale, slug } = resolve(splat);
    if (!getDocPage(locale, slug)) throw notFound();
  },
  component: SplatRoute,
  notFoundComponent: SplatNotFound,
});
