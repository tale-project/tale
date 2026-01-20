import { createFileRoute, Outlet } from '@tanstack/react-router';
import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/automations')({
  component: AutomationsLayout,
});

function AutomationsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('automations');

  return (
    <>
      <StickyHeader>
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        <Outlet />
      </LayoutErrorBoundary>
    </>
  );
}
