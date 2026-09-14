import { Button } from '@tale/ui/button';
import { Heading } from '@tale/ui/heading';
import { Link } from '@tanstack/react-router';

import { firstNavSlug } from '@/lib/content/nav';
import { docPath } from '@/lib/content/paths';
import { useT } from '@/lib/i18n/client';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

/**
 * The 404. Rendered inside the app chrome's colour scheme rather than the
 * marketing one, because most ways to land here are a stale link to a page
 * that used to exist under `/docs`.
 */
export function NotFoundPage() {
  const { t } = useT('docs');
  const { t: tSeo } = useT('seo');

  useDocumentMeta({
    title: `${t('notFoundTitle')} | ${tSeo('siteTitle')}`,
    description: t('notFoundBody'),
    canonicalPath: '/404',
    noindex: true,
  });

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center"
      >
        <Heading level={1} size="2xl">
          {t('notFoundTitle')}
        </Heading>
        <p className="text-muted-foreground text-base leading-relaxed">
          {t('notFoundBody')}
        </p>
        <Button asChild variant="secondary">
          <Link to={docPath(firstNavSlug())}>{t('notFoundBackHome')}</Link>
        </Button>
      </main>
    </div>
  );
}
