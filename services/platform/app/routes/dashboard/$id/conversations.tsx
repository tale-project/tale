import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { LayoutErrorBoundary } from '@/app/components/error-boundaries/boundaries/layout-error-boundary';
import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { StickyHeader } from '@/app/components/layout/sticky-header';
import { ConversationsNavigation } from '@/app/features/conversations/components/conversations-navigation';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/conversations')({
  head: () => ({
    meta: seo('conversations'),
  }),
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
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <StickyHeader>
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
        <ConversationsNavigation organizationId={organizationId} />
      </StickyHeader>
      <LayoutErrorBoundary organizationId={organizationId}>
        <ContentWrapper className="flex size-full max-h-full flex-1 flex-row">
          <Outlet />
        </ContentWrapper>
      </LayoutErrorBoundary>
    </div>
  );
}
