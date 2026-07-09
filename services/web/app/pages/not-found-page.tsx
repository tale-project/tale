import { Button } from '@tale/ui/button';

import { LocalizedLink } from '@/app/components/layout/localized-link';
import { SiteContainer } from '@/app/components/layout/site-container';
import { useT } from '@/lib/i18n/client';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';

/**
 * Rendered for unknown URLs — client-side via the root route's
 * `notFoundComponent`, and prerendered once to `dist/404/index.html` so the
 * server can answer unknown paths with a real HTTP 404 (English shell; the
 * client re-localizes after mount).
 */
export function NotFoundPage() {
  const { t } = useT('notFound');

  useDocumentMeta({
    title: t('title'),
    description: t('body'),
    noindex: true,
  });

  return (
    <SiteContainer>
      <div className="mx-auto flex max-w-135 flex-col items-center gap-6 py-24 text-center md:py-36">
        <p className="text-fg-subtle text-sm font-medium tracking-wide uppercase">
          404
        </p>
        <h1
          className="text-fg-base text-4xl font-medium md:text-[52px]"
          style={{ letterSpacing: '-2.14px', lineHeight: 1.077 }}
        >
          {t('title')}
        </h1>
        <p className="text-fg-muted text-base md:text-lg">{t('body')}</p>
        <Button asChild>
          <LocalizedLink to="/">{t('backHome')}</LocalizedLink>
        </Button>
      </div>
    </SiteContainer>
  );
}
