import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
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
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {!isSpecificAutomation && (
        <StickyHeader>
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
          <AutomationsListNavigation organizationId={organizationId} />
        </StickyHeader>
      )}
      <LayoutErrorBoundary organizationId={organizationId}>
        <Outlet />
      </LayoutErrorBoundary>
    </div>
  );
}
