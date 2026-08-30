import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { Conversations } from '@/app/features/conversations/components/conversations';
import {
  useApproxConversationCountByStatus,
  useListConversationsPaginated,
} from '@/app/features/conversations/hooks/queries';
import { prefetchAdaptedQuery } from '@/app/lib/backend/prefetch';
import { api } from '@/convex/_generated/api';
import type { Doc } from '@/convex/_generated/dataModel';

const INITIAL_NUM_ITEMS = 30;

const VALID_STATUSES = ['open', 'closed', 'archived', 'spam'] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];
type ConversationStatus = Doc<'conversations'>['status'];

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
        api.conversations.queries.approxCountConversationsByStatus,
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
 * The Inbox's channel-filter options. They were derived from the installed
 * inbox automations' required connectors; that backend is offline while it
 * is rebuilt, so the filter has no providers to offer and stays hidden (an
 * empty option list) until the automations rebuild restores the source.
 */
function useChannelOptions(
  _organizationId: string,
): Array<{ value: string; label: string }> {
  return EMPTY_CHANNEL_OPTIONS;
}

// Stable identity so downstream memos don't re-run every render.
const EMPTY_CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [];

function ConversationsStatusPage() {
  const { id: organizationId, status } = Route.useParams();
  const { search, conversation, channel, compose, composeContact } =
    Route.useSearch();
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
    // param and lands on the query's `connectorName` arg.
    ...(channel !== undefined && { connectorName: channel }),
    initialNumItems: INITIAL_NUM_ITEMS,
  });

  const channelOptions = useChannelOptions(organizationId);
  const handleChannelChange = useCallback(
    (value?: string) => {
      void navigate({
        to: '/dashboard/$id/conversations/$status',
        params: { id: organizationId, status },
        search: (prev) => ({ ...prev, channel: value }),
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
        value: channel,
        onChange: handleChannelChange,
      }}
      composing={compose !== undefined}
      composeContact={composeContact}
    />
  );
}
