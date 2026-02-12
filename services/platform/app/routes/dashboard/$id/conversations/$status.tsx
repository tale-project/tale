import { createFileRoute, notFound } from '@tanstack/react-router';
import { z } from 'zod';

import type { Doc } from '@/convex/_generated/dataModel';

import { ConversationsClient } from '@/app/features/conversations/components/conversations-client';

const VALID_STATUSES = ['open', 'closed', 'archived', 'spam'] as const;
type ConversationStatus = Doc<'conversations'>['status'];

const conversationStatusMap: Record<string, ConversationStatus> = {
  open: 'open',
  closed: 'closed',
  archived: 'archived',
  spam: 'spam',
};

const searchSchema = z.object({
  category: z.string().optional(),
  priority: z.string().optional(),
  search: z.string().optional(),
  page: z.string().optional(),
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
  const { category, priority, search, page = '1' } = Route.useSearch();

  return (
    <ConversationsClient
      key={`${organizationId}-${status}`}
      status={conversationStatusMap[status] ?? 'open'}
      organizationId={organizationId}
      page={parseInt(page)}
      limit={20}
      priority={priority && priority.length > 0 ? priority : undefined}
      category={category && category.length > 0 ? category : undefined}
      search={search && search.length > 0 ? search : undefined}
    />
  );
}
