import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { ConversationsNavigation } from '@/app/features/conversations/components/conversations-navigation';
import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/conversations')({
  beforeLoad: ({ params, location }) => {
    if (location.pathname === `/dashboard/${params.id}/conversations`) {
      throw redirect({
        to: '/dashboard/$id/conversations/$status',
        params: { id: params.id, status: 'open' },
      });
    }
  },
  component: ConversationsLayout,
});

function ConversationsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('conversations');

  return (
    <>
      <StickyHeader>
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
        <ConversationsNavigation organizationId={organizationId} />
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        <ContentWrapper className="flex flex-row size-full flex-1 max-h-full">
          <Outlet />
        </ContentWrapper>
      </LayoutErrorBoundary>
    </>
  );
}
