import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import {
  Conversations,
  type ReadFilter,
} from '@/app/features/conversations/components/conversations';
import {
  useApproxConversationCountByStatus,
  useEmailConnectors,
  useListConversationsPaginated,
  useMailboxes,
} from '@/app/features/conversations/hooks/queries';
import {
  channelFilterOf,
  channelOptionsOf,
  mailboxOptionValue,
} from '@/app/features/conversations/lib/channel-source';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import type { ConversationRow } from '@/app/lib/backend/contract/docs';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { useT } from '@/lib/i18n/client';

const INITIAL_NUM_ITEMS = 30;

const VALID_STATUSES = ['open', 'closed', 'archived', 'spam'] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];
type ConversationStatus = ConversationRow['status'];

function isValidStatus(value: string): value is ValidStatus {
  return VALID_STATUSES.some((s) => s === value);
}

const conversationStatusMap: Record<ValidStatus, ConversationStatus> = {
  open: 'open',
  closed: 'closed',
  archived: 'archived',
  spam: 'spam',
};

const searchSchema = z.object({
  search: z.string().optional(),
  conversation: z.string().optional(),
  /** Channel filter: an inbox provider's connector slug (e.g. `gmail`). */
  channel: z.string().optional(),
  /** Channel filter narrowed to one mailbox (a connector credential id), for
   *  a connector that holds several. */
  mailbox: z.string().optional(),
  /**
   * Assignee filter: a comma-separated list of user ids, team ids and the
   * `__me__` / `__unassigned__` / `__my-teams__` sentinels. In the URL so a
   * filtered inbox survives a reload and can be shared.
   */
  assignee: z.string().optional(),
  /** Read-status filter. Absent means every read state. */
  read: z.enum(['all', 'read', 'unread']).optional(),
  /** Compose mode: any value opens the compose pane in the reading pane. */
  compose: z.string().optional(),
  /** Contact id to seed the composer with (from a contact-row "Email" action). */
  composeContact: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/conversations/$status')({
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => {
    if (!isValidStatus(params.status)) {
      throw notFound();
    }
  },
  loader: ({ context, params }) => {
    if (isValidStatus(params.status)) {
      const status = params.status;
      prefetchAdaptedQuery(
        context.queryClient,
        'conversations/queries:approxCountConversationsByStatus',
        {
          organizationId: params.id,
          status,
        },
      );
      // Prime the paginated list cache so the first page paints without a
      // skeleton flash on first nav. Args mirror useListConversationsPaginated's
      // base args (search is an in-page filter — live subscription; the
      // channel filter subscribes with its own args when active).
    }
  },
  component: ConversationsStatusPage,
});

/**
 * The Inbox's channel-filter options: every lane a thread can arrive on.
 *
 * Email connectors come from the installed inbox automations' required
 * connectors, named by their credential's title; a connector holding several
 * mailboxes lists each of them instead. API sources come from the threads
 * themselves — an integration names its own source slug, so there is no
 * catalog to read it from.
 *
 * The value is what the server filters on (`connectorName`, or one mailbox's
 * credential), so the namespaces share one list without colliding.
 */
function useChannelOptions(
  organizationId: string,
): Array<{ value: string; label: string }> {
  const { t } = useT('conversations');
  const { emailConnectors } = useEmailConnectors(organizationId);
  const { mailboxes } = useMailboxes();
  const { data: apiSources } = useBackendQuery(
    'conversations/queries:apiSources',
    organizationId ? { organizationId } : 'skip',
  );

  return useMemo(() => {
    const options = channelOptionsOf(
      emailConnectors,
      apiSources ?? [],
      mailboxes,
      (name) => t('filter.mailboxInactive', { name }),
    );
    return options.length === 0 ? EMPTY_CHANNEL_OPTIONS : options;
  }, [emailConnectors, apiSources, mailboxes, t]);
}

// Stable identity so downstream memos don't re-run every render.
const EMPTY_CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [];

function ConversationsStatusPage() {
  const { id: organizationId, status } = Route.useParams();
  const {
    search,
    conversation,
    channel,
    mailbox,
    assignee,
    read,
    compose,
    composeContact,
  } = Route.useSearch();
  const navigate = useNavigate();

  const mappedStatus =
    (isValidStatus(status) ? conversationStatusMap[status] : undefined) ??
    'open';

  const counts = {
    open: useApproxConversationCountByStatus(organizationId, 'open').data,
    closed: useApproxConversationCountByStatus(organizationId, 'closed').data,
    spam: useApproxConversationCountByStatus(organizationId, 'spam').data,
    archived: useApproxConversationCountByStatus(organizationId, 'archived')
      .data,
  };

  const conversationCount = counts[mappedStatus];

  const allCounts = Object.values(counts);
  const totalConversationCount = allCounts.some((c) => c === undefined)
    ? undefined
    : allCounts.reduce((sum: number, c) => sum + (c ?? 0), 0);

  const paginatedResult = useListConversationsPaginated({
    organizationId,
    status: mappedStatus,
    // The channel filter is server-side: the slug rides the `channel` search
    // param and lands on the query's `connectorName` arg; one mailbox rides
    // `mailbox` and lands on `credentialId`.
    ...(channel !== undefined && { connectorName: channel }),
    ...(mailbox !== undefined && { credentialId: mailbox }),
    initialNumItems: INITIAL_NUM_ITEMS,
  });

  const channelOptions = useChannelOptions(organizationId);
  const handleChannelChange = useCallback(
    (value?: string) => {
      void navigate({
        to: '/dashboard/$id/conversations/$status',
        params: { id: organizationId, status },
        search: (prev) => {
          const filter = channelFilterOf(value);
          return { ...prev, channel: filter.channel, mailbox: filter.mailbox };
        },
        replace: true,
      });
    },
    [navigate, organizationId, status],
  );
  // The assignee facet is multi-select, and a TanStack search param is one
  // string, so the selection rides the URL comma-separated. An empty selection
  // drops the param instead of leaving `?assignee=` behind.
  const assigneeFilter = useMemo(
    () => (assignee === undefined ? [] : assignee.split(',').filter(Boolean)),
    [assignee],
  );
  const handleAssigneeChange = useCallback(
    (values: string[]) => {
      void navigate({
        to: '/dashboard/$id/conversations/$status',
        params: { id: organizationId, status },
        search: (prev) => ({
          ...prev,
          assignee: values.length > 0 ? values.join(',') : undefined,
        }),
        replace: true,
      });
    },
    [navigate, organizationId, status],
  );
  const handleReadChange = useCallback(
    (value: ReadFilter) => {
      void navigate({
        to: '/dashboard/$id/conversations/$status',
        params: { id: organizationId, status },
        search: (prev) => ({
          ...prev,
          read: value === 'all' ? undefined : value,
        }),
        replace: true,
      });
    },
    [navigate, organizationId, status],
  );

  return (
    <Conversations
      key={`${organizationId}-${status}`}
      status={mappedStatus}
      organizationId={organizationId}
      search={search && search.length > 0 ? search : undefined}
      initialConversationId={conversation}
      paginatedResult={paginatedResult}
      conversationCount={conversationCount}
      totalConversationCount={totalConversationCount}
      channelFilter={{
        options: channelOptions,
        value: mailbox !== undefined ? mailboxOptionValue(mailbox) : channel,
        onChange: handleChannelChange,
      }}
      assigneeFilter={assigneeFilter}
      onAssigneeFilterChange={handleAssigneeChange}
      readFilter={read ?? 'all'}
      onReadFilterChange={handleReadChange}
      composing={compose !== undefined}
      composeContact={composeContact}
    />
  );
}
