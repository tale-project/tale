import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { z } from 'zod';

import type { Doc } from '@/convex/_generated/dataModel';

import { ConversationsClient } from '@/app/features/conversations/components/conversations-client';
import {
  useApproxConversationCountByStatus,
  useListConversationsPaginated,
} from '@/app/features/conversations/hooks/queries';
import { api } from '@/convex/_generated/api';

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
  priority: z.string().optional(),
  search: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/conversations/$status')({
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => {
    if (!isValidStatus(params.status)) {
      throw notFound();
    }
  },
  loader: async ({ context, params }) => {
    if (isValidStatus(params.status)) {
      void context.queryClient.prefetchQuery(
        convexQuery(
          api.conversations.queries.approxCountConversationsByStatus,
          {
            organizationId: params.id,
            status: params.status,
          },
        ),
      );
    }
  },
  component: ConversationsStatusPage,
});

function ConversationsStatusPage() {
  const { id: organizationId, status } = Route.useParams();
  const { priority, search } = Route.useSearch();

  const mappedStatus =
    (isValidStatus(status) ? conversationStatusMap[status] : undefined) ??
    'open';

  const { data: conversationCount } = useApproxConversationCountByStatus(
    organizationId,
    mappedStatus,
  );

  const paginatedResult = useListConversationsPaginated({
    organizationId,
    status: mappedStatus,
    priority: priority && priority.length > 0 ? priority : undefined,
    initialNumItems: 30,
  });

  return (
    <ConversationsClient
      key={`${organizationId}-${status}`}
      status={mappedStatus}
      organizationId={organizationId}
      search={search && search.length > 0 ? search : undefined}
      paginatedResult={paginatedResult}
      conversationCount={conversationCount}
    />
  );
}
