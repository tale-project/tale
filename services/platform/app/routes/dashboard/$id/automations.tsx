import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { AutomationsListNavigation } from '@/app/features/automations/components/automations-list-navigation';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/automations')({
  head: () => ({
    meta: seo('automations'),
  }),
  component: AutomationsLayout,
});

function AutomationsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('automations');

  const isSpecificAutomation = useMatch({
    from: '/dashboard/$id/automations/$amId',
    shouldThrow: false,
  });

  return (
    <PageLayout
      organizationId={organizationId}
      header={
        !isSpecificAutomation ? (
          <>
            <AdaptiveHeaderRoot standalone={false}>
              <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
            </AdaptiveHeaderRoot>
            <AutomationsListNavigation organizationId={organizationId} />
          </>
        ) : undefined
      }
    >
      <Outlet />
    </PageLayout>
  );
}
