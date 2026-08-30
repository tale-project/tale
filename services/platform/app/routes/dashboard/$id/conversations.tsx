import { Button } from '@tale/ui/button';
import { EmptyState } from '@tale/ui/empty-state';
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useNavigate,
  useParams,
  useSearch,
} from '@tanstack/react-router';
import { Inbox, SquarePen } from 'lucide-react';
import { useEffect } from 'react';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { ContentWrapper } from '@/app/components/layout/content-wrapper';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ConversationsNavigation } from '@/app/features/conversations/components/conversations-navigation';
import { InboxMobileBackButton } from '@/app/features/conversations/components/inbox-mobile-back-button';
import { useComposeContactName } from '@/app/features/conversations/hooks/queries';
import { useInboxAvailability } from '@/app/features/conversations/hooks/use-inbox-availability';
import { useAuth } from '@/app/hooks/use-convex-auth';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
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
      prefetchAdaptedQuery(
        context.queryClient,
        api.conversations.queries.approxCountConversationsByStatus,
        {
          organizationId: params.id,
          status,
        },
      );
    }
  },
  component: ConversationsLayout,
});

/** localStorage key for a compose intent stashed while no mailbox is
 *  connected (see {@link ConversationsLayout}) — scoped per member+org like
 *  the compose draft keys in `ComposeEmailPane`. */
function pendingComposeKey(userId: string | undefined, organizationId: string) {
  return userId
    ? `conversations-pending-compose-${userId}-${organizationId}`
    : `conversations-pending-compose-${organizationId}`;
}

interface PendingCompose {
  compose: string;
  composeContact?: string;
}

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

  // `compose`/`composeContact` (a contact-row "New email" action) are owned by
  // the `$status` child route's `validateSearch` — but that route's component
  // never mounts while there's no inbox to show it in (the early return
  // below), so read them loosely here too. Without this the params are
  // silently dropped the moment a mailbox isn't connected yet (#2641).
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const composeParam =
    typeof rawSearch.compose === 'string' ? rawSearch.compose : undefined;
  const composeContactParam =
    typeof rawSearch.composeContact === 'string'
      ? rawSearch.composeContact
      : undefined;

  const { user } = useAuth();
  const [pendingCompose, setPendingCompose, clearPendingCompose] =
    usePersistedState<PendingCompose | null>(
      pendingComposeKey(user?.userId, organizationId),
      null,
    );

  // No mailbox yet: stash the compose intent so it survives the round trip to
  // the Automations catalog and back (nothing else holds it — the child route
  // that owns these params never mounts here).
  useEffect(() => {
    if (!isLoading && !hasInbox && composeParam !== undefined) {
      setPendingCompose({
        compose: composeParam,
        composeContact: composeContactParam,
      });
    }
  }, [
    isLoading,
    hasInbox,
    composeParam,
    composeContactParam,
    setPendingCompose,
  ]);

  // A mailbox now exists: resume the stashed intent exactly once, then forget
  // it — reopens the same compose the user started before setup.
  useEffect(() => {
    if (!isLoading && hasInbox && pendingCompose) {
      clearPendingCompose();
      void navigate({
        to: '/dashboard/$id/conversations/$status',
        params: { id: organizationId, status: currentStatus },
        search: (prev) => ({
          ...prev,
          compose: pendingCompose.compose,
          composeContact: pendingCompose.composeContact,
        }),
        replace: true,
      });
    }
  }, [
    isLoading,
    hasInbox,
    pendingCompose,
    clearPendingCompose,
    navigate,
    organizationId,
    currentStatus,
  ]);

  // Only resolve the contact while the notice below can actually use it — has
  // its own `skip` gate, so a connected inbox never carries this subscription.
  const { name: composeContactName, isLoading: isComposeContactLoading } =
    useComposeContactName(
      organizationId,
      !isLoading && !hasInbox ? composeContactParam : undefined,
    );

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
              description={
                composeContactParam && !isComposeContactLoading ? (
                  <>
                    {t('activate.noAutomationDescription')}{' '}
                    <span className="text-foreground font-medium">
                      {t('activate.composeNotice', {
                        name: composeContactName ?? t('unknownContact'),
                      })}
                    </span>
                  </>
                ) : (
                  t('activate.noAutomationDescription')
                )
              }
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
          <AdaptiveHeaderRoot standalone={false} className="gap-1">
            <InboxMobileBackButton />
            <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
          </AdaptiveHeaderRoot>
          <ConversationsNavigation
            organizationId={organizationId}
            action={
              composeParam === undefined ? (
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
              ) : undefined
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
