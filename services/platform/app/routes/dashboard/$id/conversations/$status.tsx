import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { Conversations } from '@/app/features/conversations/components/conversations';
import {
  useApproxConversationCountByStatus,
  useListConversationsPaginated,
} from '@/app/features/conversations/hooks/queries';
import { useInboxChannelOptions } from '@/app/features/conversations/hooks/use-inbox-channel-options';
import type { ReadFilter } from '@/app/features/conversations/hooks/use-inbox-list';
import {
  channelFilterOf,
  mailboxOptionValue,
} from '@/app/features/conversations/lib/channel-source';
import type { ConversationRow } from '@/app/lib/backend/contract/docs';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';

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

  const channelOptions = useInboxChannelOptions(organizationId);
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
