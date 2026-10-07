import { DocsNotFound } from '@tale/ui/docs/docs-not-found';
import { slugLabel, suggestPages } from '@tale/ui/docs/suggest-pages';
import { useRouterState } from '@tanstack/react-router';
import { useMemo } from 'react';

import { firstNavSlug } from '@/lib/content/nav';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import type { SupportedLocale } from '@/lib/i18n/locales';
import { docsNearMissGroups, docsNearMissPages } from '@/lib/near-miss';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

interface NotFoundPageProps {
  locale: SupportedLocale;
}

/** Strip leading locale prefix + slashes so we compare slug-to-slug. */
function pathnameToSlug(pathname: string, locale: SupportedLocale): string {
  let p = pathname.replace(/^\/+|\/+$/g, '');
  if (locale !== 'en' && (p === locale || p.startsWith(`${locale}/`))) {
    p = p.slice(locale.length).replace(/^\/+/, '');
  }
  return p;
}

export function NotFoundPage({ locale }: NotFoundPageProps) {
  const { t } = useT('docs');
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const requestedSlug = pathnameToSlug(pathname, locale);
  const home = t('home');
  const suggestions = useMemo(
    () =>
      // Ranked on titles and sidebar labels in every locale as well as
      // slugs — the same pages the server scores a guessed address against.
      suggestPages(
        requestedSlug,
        docsNearMissPages(),
        undefined,
        docsNearMissGroups(),
      ).map(({ slug }) => ({
        href: docPath(locale, slug),
        label: slugLabel(slug),
      })),
    [locale, requestedSlug],
  );

  // The page copy is the shared frame's (`docs.notFound.*` in `@tale/ui`);
  // the document head reads the same strings, so the tab says what the
  // heading says.
  useDocumentMeta({
    title: t('notFound.title'),
    description: t('notFound.body'),
    canonicalPath: '/404',
    locale,
    noindex: true,
  });

  return (
    <DocsNotFound
      home={{ href: docPath(locale, firstNavSlug()), label: home }}
      suggestions={suggestions}
    />
  );
}
