import { DocsNotFound } from '@tale/ui/docs/docs-not-found';
import { suggestPages } from '@tale/ui/docs/suggest-pages';
import { useRouterState } from '@tanstack/react-router';
import { useMemo } from 'react';

import { UiDocsLayout } from '@/app/components/docs/ui-docs-layout';
import { firstNavSlug, flattenNav } from '@/lib/content/nav';
import { navPage } from '@/lib/content/nav-sections';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

/** The requested path as a content slug: `/docs/components/buton` → `components/buton`. */
function pathnameToSlug(pathname: string): string {
  return pathname.replace(/^\/+|\/+$/g, '').replace(/^docs(?:\/|$)/, '');
}

/**
 * The 404, inside the same docs frame as every page: most ways to land here
 * are a stale link to a page that used to exist under `/docs`, so the closest
 * pages come first and the introduction is one click away.
 */
export function NotFoundPage() {
  const { t } = useT('docs');
  const { t: tSeo } = useT('seo');
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const requestedSlug = pathnameToSlug(pathname);
  const suggestions = useMemo(
    () =>
      suggestPages(requestedSlug, flattenNav()).map(({ slug }) =>
        navPage(slug),
      ),
    [requestedSlug],
  );

  // The page copy is the shared frame's (`docs.notFound.*` in `@tale/ui`);
  // the document head reads the same strings, so the tab says what the
  // heading says.
  useDocumentMeta({
    title: `${t('notFound.title')} | ${tSeo('siteTitle')}`,
    description: t('notFound.body'),
    canonicalPath: '/404',
    noindex: true,
  });

  return (
    <UiDocsLayout activeHref={pathname}>
      <DocsNotFound
        home={{ href: docPath(firstNavSlug()), label: t('home') }}
        suggestions={suggestions}
      />
    </UiDocsLayout>
  );
}
