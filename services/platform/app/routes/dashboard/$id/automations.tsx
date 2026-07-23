import { createFileRoute, Outlet } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { PageLayout } from '@/app/components/layout/page-layout';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/automations')({
  head: () => ({ meta: seo('automations') }),
  component: AutomationsLayout,
});

/** Shell for the automations area — the listing, one automation's canvas, and
 * one run all render under this header, which owns the page's only `h1`. */
function AutomationsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('automations');
  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <AdaptiveHeaderRoot>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
      }
    >
      <ContentArea className="flex-1">
        <Outlet />
      </ContentArea>
    </PageLayout>
  );
}
