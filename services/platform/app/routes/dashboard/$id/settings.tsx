import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { SettingsNavigation } from '@/app/features/settings/components/settings-navigation';
import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { useT } from '@/lib/i18n/client';
import { Skeleton } from '@/app/components/ui/feedback/skeleton';

export const Route = createFileRoute('/dashboard/$id/settings')({
  component: SettingsLayout,
});

function SettingsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('settings');

  const userContext = useQuery(api.queries.member.getCurrentMemberContext, { organizationId });

  if (userContext === undefined) {
    return (
      <>
        <StickyHeader>
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
          <div className="flex gap-2 p-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-24" />
          </div>
        </StickyHeader>
        <ContentWrapper className="p-4">
          <Skeleton className="h-96 w-full" />
        </ContentWrapper>
      </>
    );
  }

  const userRole = userContext?.member?.role ?? 'Member';
  const canChangePassword = userContext?.canChangePassword ?? true;

  return (
    <>
      <StickyHeader>
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
        <SettingsNavigation
          organizationId={organizationId}
          userRole={userRole}
          canChangePassword={canChangePassword}
        />
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        <ContentWrapper className="p-4">
          <Outlet />
        </ContentWrapper>
      </LayoutErrorBoundary>
    </>
  );
}
