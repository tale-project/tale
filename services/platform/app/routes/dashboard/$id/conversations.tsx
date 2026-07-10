import { convexQuery } from '@convex-dev/react-query';
import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useParams,
} from '@tanstack/react-router';
import { Inbox, SquarePen } from 'lucide-react';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { PageLayout } from '@/app/components/layout/page-layout';
import { useInboxAvailability } from '@/app/features/automations/builtin-views/registry';
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
  // The Inbox is gated on an INSTALLED automation declaring the `inbox`
  // builtin view — the same signal that shows/hides the nav entry. A deep
  // link into an org without one lands on a friendly pointer to the
  // Automations catalog instead of an inbox that can never fill.
  const { isLoading, hasInbox } = useInboxAvailability(organizationId);
  const navigate = useNavigate();
  // The active status tab lives on the child route; read it (strict: false) so
  // Compose opens the pane on whichever tab the user is viewing.
  const params = useParams({ strict: false });
  const currentStatus =
    typeof params.status === 'string' ? params.status : 'open';

  if (isLoading || !hasInbox) {
    return (
      <PageLayout
        organizationId={organizationId}
        header={
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
        }
      >
        <ContentWrapper className="flex size-full max-h-full flex-1 flex-row">
          {/* While availability loads, keep the shell empty — no flash of the
              empty state (or of the inbox) before the answer is in. */}
          {!isLoading && (
            <EmptyState
              icon={Inbox}
              headingLevel={2}
              className="flex-1 self-center"
              title={t('activate.noAutomationTitle')}
              description={t('activate.noAutomationDescription')}
              action={
                <Button asChild>
                  <Link
                    to="/dashboard/$id/automations"
                    params={{ id: organizationId }}
                  >
                    {t('activate.browseAutomations')}
                  </Link>
                </Button>
              }
            />
          )}
        </ContentWrapper>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      organizationId={organizationId}
      // The inbox is a fixed-height, two-pane layout: the list and the reading
      // pane each scroll independently. Override the default page-level scroll
      // so the conversation list can't be pushed out of view when the reading
      // pane scrolls.
      className="overflow-hidden"
      header={
        <>
          <AdaptiveHeaderRoot standalone={false}>
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
          <ConversationsNavigation
            organizationId={organizationId}
            action={
              <Button
                size="sm"
                variant="secondary"
                icon={SquarePen}
                onClick={() =>
                  void navigate({
                    to: '/dashboard/$id/conversations/$status',
                    params: { id: organizationId, status: currentStatus },
                    search: (prev) => ({
                      ...prev,
                      compose: 'new',
                      composeContact: undefined,
                      conversation: undefined,
                    }),
                  })
                }
              >
                {t('compose.compose')}
              </Button>
            }
          />
        </>
      }
    >
      <ContentWrapper className="flex size-full max-h-full flex-1 flex-row">
        <Outlet />
      </ContentWrapper>
    </PageLayout>
  );
}
