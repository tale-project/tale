import { isChunkLoadFailure } from '@tale/ui/stale-bundle';
import { type ErrorComponentProps, useRouter } from '@tanstack/react-router';

import { SiteContainer } from '@/app/components/layout/site-container';
import {
  MarketingButton,
  MarketingLink,
  MarketingStack,
  SectionHeading,
} from '@/app/components/marketing';
import { useT } from '@/lib/i18n/client';
import { useDocumentMeta } from '@/lib/seo/use-document-meta';
import { reloadPage } from '@/lib/stale-bundle-reload';

/**
 * Rendered in place of a page that could not be loaded — the router's
 * `defaultErrorComponent` on the client and in SSR, so it sits inside the
 * site chrome as `NotFoundPage` does. A loader whose content did not arrive
 * (the compare and use-case pages fetch theirs) and a chunk a deploy replaced
 * both end here. It says so in plain words and never shows the error itself:
 * that goes to the error reporter (`defaultOnCatch` in `app/router.tsx`).
 *
 * Try again re-runs the route's loaders in place. A chunk the page could not
 * fetch stays failed for the page's lifetime (`lazyRouteComponent` keeps its
 * error), so after one of those Try again reloads the page instead.
 */
export function ErrorPage({ error }: ErrorComponentProps) {
  const router = useRouter();
  const { t } = useT('pageError');
  const { t: tNotFound } = useT('notFound');

  useDocumentMeta({
    title: t('title'),
    description: t('body'),
    noindex: true,
  });

  const retry = () => {
    if (isChunkLoadFailure(error)) reloadPage();
    else void router.invalidate();
  };

  return (
    <SiteContainer>
      <MarketingStack
        max="sm"
        gap="md"
        align="center"
        className="py-24 md:py-36"
      >
        <div role="alert">
          <SectionHeading
            bare
            as="h1"
            size="section"
            title={t('title')}
            description={t('body')}
          />
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <MarketingButton type="button" onClick={retry}>
            {t('retry')}
          </MarketingButton>
          <MarketingButton asChild tone="secondary">
            <MarketingLink to="/" tone="plain">
              {tNotFound('backHome')}
            </MarketingLink>
          </MarketingButton>
        </div>
      </MarketingStack>
    </SiteContainer>
  );
}
