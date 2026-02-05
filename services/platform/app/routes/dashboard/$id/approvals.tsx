import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { ApprovalsNavigation } from '@/app/features/approvals/components/approvals-navigation';
import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/approvals')({
  beforeLoad: ({ params, location }) => {
    if (location.pathname === `/dashboard/${params.id}/approvals`) {
      throw redirect({
        to: '/dashboard/$id/approvals/$status',
        params: { id: params.id, status: 'pending' },
      });
    }
  },
  component: ApprovalsLayout,
});

function ApprovalsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('approvals');

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <StickyHeader>
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
        <ApprovalsNavigation organizationId={organizationId} />
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        <ContentWrapper className="px-4 py-6">
          <Outlet />
        </ContentWrapper>
      </LayoutErrorBoundary>
    </div>
  );
}
