import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { KnowledgeNavigation } from '@/app/features/knowledge/components/knowledge-navigation';
import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { useT } from '@/lib/i18n/client';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';

export const Route = createFileRoute('/dashboard/$id/_knowledge')({
  component: KnowledgeLayout,
});

function KnowledgeLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('knowledge');

  const userContext = useQuery(api.members.queries.getCurrentMemberContext, { organizationId });

  if (userContext === undefined) {
    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-auto">
        <StickyHeader>
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
          <div className="flex gap-2 p-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </StickyHeader>
        <ContentWrapper className="p-4">
          <Skeleton className="h-96 w-full" />
        </ContentWrapper>
      </div>
    );
  }

  const userRole = userContext?.role ?? 'member';

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-auto">
      <StickyHeader>
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
        <KnowledgeNavigation
          organizationId={organizationId}
          userRole={userRole}
        />
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        <ContentWrapper className="p-4">
          <Outlet />
        </ContentWrapper>
      </LayoutErrorBoundary>
    </div>
  );
}
