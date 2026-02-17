import { createFileRoute, notFound } from '@tanstack/react-router';
import { z } from 'zod';

import type { Doc } from '@/convex/_generated/dataModel';

import { ConversationsClient } from '@/app/features/conversations/components/conversations-client';
import {
  useHasConversations,
  useListConversationsPaginated,
} from '@/app/features/conversations/hooks/queries';

const VALID_STATUSES = ['open', 'closed', 'archived', 'spam'] as const;
type ConversationStatus = Doc<'conversations'>['status'];

const conversationStatusMap: Record<string, ConversationStatus> = {
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
    if (!VALID_STATUSES.some((s) => s === params.status)) {
      throw notFound();
    }
  },
  component: ConversationsStatusPage,
});

function ConversationsStatusPage() {
  const { id: organizationId, status } = Route.useParams();
  const { priority, search } = Route.useSearch();

  const mappedStatus = conversationStatusMap[status] ?? 'open';

  const { hasConversations } = useHasConversations(organizationId);

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
      hasConversations={hasConversations}
    />
  );
}
