import { SiteContainer } from '@/app/components/layout/site-container';
import {
  MarketingButton,
  MarketingLink,
  MarketingStack,
  SectionHeading,
} from '@/app/components/marketing';
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
  const { t: tFooter } = useT('footer');

  useDocumentMeta({
    title: t('title'),
    description: t('body'),
    noindex: true,
  });

  return (
    <SiteContainer>
      <MarketingStack
        max="sm"
        gap="md"
        align="center"
        className="py-24 md:py-36"
      >
        <p className="text-fg-subtle text-sm font-medium tracking-wide uppercase">
          404
        </p>
        <SectionHeading
          bare
          as="h1"
          size="section"
          title={t('title')}
          description={t('body')}
        />
        <MarketingButton asChild>
          <MarketingLink to="/" tone="plain">
            {t('backHome')}
          </MarketingLink>
        </MarketingButton>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-2">
          <MarketingLink to="/platform" tone="subtle">
            {tFooter('platform')}
          </MarketingLink>
          <MarketingLink to="/pricing" tone="subtle">
            {tFooter('pricing')}
          </MarketingLink>
          <MarketingLink to="/changelog" tone="subtle">
            {tFooter('changelog')}
          </MarketingLink>
          <MarketingLink to="/contact" tone="subtle">
            {tFooter('contact')}
          </MarketingLink>
        </div>
      </MarketingStack>
    </SiteContainer>
  );
}
