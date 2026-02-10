import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { AccessDenied } from '@/app/components/layout/access-denied';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/custom-agents')({
  component: CustomAgentsLayout,
});

function CustomAgentsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('settings');
  const { t: tAccessDenied } = useT('accessDenied');

  const isDetailPage = useMatch({
    from: '/dashboard/$id/custom-agents/$agentId',
    shouldThrow: false,
  });

  const memberContext = useQuery(api.members.queries.getCurrentMemberContext, {
    organizationId,
  });

  if (memberContext === undefined || memberContext === null) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-auto">
        <StickyHeader>
          <AdaptiveHeaderRoot standalone={false}>
            <Skeleton className="h-5 w-40" />
          </AdaptiveHeaderRoot>
        </StickyHeader>
      </div>
    );
  }

  if (!memberContext.isAdmin && memberContext.role !== 'developer') {
    return <AccessDenied message={tAccessDenied('customAgents')} />;
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      {!isDetailPage && (
        <StickyHeader>
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>
              {t('customAgents.title')}
            </AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
        </StickyHeader>
      )}
      <LayoutErrorBoundary organizationId={organizationId}>
        <Outlet />
      </LayoutErrorBoundary>
    </div>
  );
}
