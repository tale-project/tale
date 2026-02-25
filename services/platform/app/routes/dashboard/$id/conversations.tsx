import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ConversationsNavigation } from '@/app/features/conversations/components/conversations-navigation';
import { api } from '@/convex/_generated/api';
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
  loader: ({ context, params }) => {
    const statuses = ['open', 'closed', 'spam', 'archived'] as const;
    for (const status of statuses) {
      void context.queryClient.prefetchQuery(
        convexQuery(
          api.conversations.queries.approxCountConversationsByStatus,
          {
            organizationId: params.id,
            status,
          },
        ),
      );
    }
  },
  component: ConversationsLayout,
});

function ConversationsLayout() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('conversations');

  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <>
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
          <ConversationsNavigation organizationId={organizationId} />
        </>
      }
    >
      <ContentWrapper className="flex size-full max-h-full flex-1 flex-row">
        <Outlet />
      </ContentWrapper>
    </PageLayout>
  );
}
