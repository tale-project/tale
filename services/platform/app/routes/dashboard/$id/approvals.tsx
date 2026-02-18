import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { ApprovalsNavigation } from '@/app/features/approvals/components/approvals-navigation';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/approvals')({
  head: () => ({
    meta: seo('approvals'),
  }),
  beforeLoad: ({ params, location }) => {
    if (location.pathname === `/dashboard/${params.id}/approvals`) {
      throw redirect({
        to: '/dashboard/$id/approvals/$status',
        params: { id: params.id, status: 'pending' },
      });
    }
  },
  loader: async ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.approvals.queries.approxCountApprovalsByStatus, {
        organizationId: params.id,
        status: 'pending',
      }),
    );
    void context.queryClient.prefetchQuery(
      convexQuery(api.approvals.queries.approxCountApprovalsByStatus, {
        organizationId: params.id,
        status: 'resolved',
      }),
    );
  },
  component: ApprovalsLayout,
});

function ApprovalsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('approvals');

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
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
