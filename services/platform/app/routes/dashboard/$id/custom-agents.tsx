import { createFileRoute, Outlet, useMatch } from '@tanstack/react-router';
import { useQuery } from 'convex/react';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';
import { api } from '@/convex/_generated/api';
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

  if (memberContext === undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <StickyHeader>
          <AdaptiveHeaderRoot standalone={false}>
            <Skeleton className="h-5 w-40" />
          </AdaptiveHeaderRoot>
        </StickyHeader>
      </div>
    );
  }

  if (
    memberContext === null ||
    (!memberContext.isAdmin && memberContext.role !== 'developer')
  ) {
    return <AccessDenied message={tAccessDenied('customAgents')} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {!isDetailPage && (
        <StickyHeader>
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{t('customAgents.title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
        </StickyHeader>
      )}
      <LayoutErrorBoundary organizationId={organizationId}>
        <Outlet />
      </LayoutErrorBoundary>
    </div>
  );
}
