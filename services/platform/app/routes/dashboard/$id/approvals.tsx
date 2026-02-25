import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentArea } from '@/app/components/layout/content-area';
import { PageLayout } from '@/app/components/layout/page-layout';
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
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.approvals.queries.approxCountApprovalsByStatus, {
        organizationId: params.id,
        status: 'resolved',
      }),
    );
    void context.queryClient.prefetchQuery(
      convexQuery(api.approvals.queries.approxCountApprovalsByStatus, {
        organizationId: params.id,
        status: 'pending',
      }),
    );
  },
  component: ApprovalsLayout,
});

function ApprovalsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('approvals');

  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <>
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
          <ApprovalsNavigation organizationId={organizationId} />
        </>
      }
    >
      <ContentArea>
        <Outlet />
      </ContentArea>
    </PageLayout>
  );
}
