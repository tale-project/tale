import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { z } from 'zod';

import { Conversations } from '@/app/features/conversations/components/conversations';
import {
  useApproxConversationCountByStatus,
  useListConversationsPaginated,
} from '@/app/features/conversations/hooks/queries';
import { primeCachedPaginatedQuery } from '@/app/hooks/use-cached-paginated-query';
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
      void context.queryClient.prefetchQuery(
        convexQuery(
          api.conversations.queries.approxCountConversationsByStatus,
          {
            organizationId: params.id,
            status,
          },
        ),
      );
      // Prime the paginated list cache so the first page paints without a
      // skeleton flash on first nav. Args mirror useListConversationsPaginated's
      // base args (search is an in-page filter — live subscription).
      void primeCachedPaginatedQuery(
        context.convexQueryClient.convexClient,
        api.conversations.queries.listConversationsPaginated,
        { organizationId: params.id, status },
        { initialNumItems: INITIAL_NUM_ITEMS },
      );
    }
  },
  component: ConversationsStatusPage,
});

function ConversationsStatusPage() {
  const { id: organizationId, status } = Route.useParams();
  const { search } = Route.useSearch();

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
    initialNumItems: INITIAL_NUM_ITEMS,
  });

  return (
    <Conversations
      key={`${organizationId}-${status}`}
      status={mappedStatus}
      organizationId={organizationId}
      search={search && search.length > 0 ? search : undefined}
      paginatedResult={paginatedResult}
      conversationCount={conversationCount}
      totalConversationCount={totalConversationCount}
    />
  );
}
