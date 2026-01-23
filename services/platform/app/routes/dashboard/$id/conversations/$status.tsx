import { createFileRoute, notFound, useLocation } from '@tanstack/react-router';
import { useMemo } from 'react';
import { z } from 'zod';
import { ConversationsClient } from '@/app/features/conversations/components/conversations-client';
import type { Doc } from '@/convex/_generated/dataModel';

const VALID_STATUSES = ['open', 'closed', 'archived', 'spam'] as const;
type ConversationStatus = (typeof VALID_STATUSES)[number];

const searchSchema = z.object({
  category: z.string().optional(),
  priority: z.string().optional(),
  search: z.string().optional(),
  page: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/conversations/$status')({
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => {
    if (!VALID_STATUSES.includes(params.status as ConversationStatus)) {
      throw notFound();
    }
  },
  component: ConversationsStatusPage,
});

function ConversationsStatusPage() {
  const location = useLocation();
  const { category, priority, search, page = '1' } = Route.useSearch();

  const { organizationId, status } = useMemo(() => {
    const pathParts = location.pathname.split('/');
    const conversationsIndex = pathParts.indexOf('conversations');
    return {
      organizationId: pathParts[2],
      status: pathParts[conversationsIndex + 1] as ConversationStatus,
    };
  }, [location.pathname]);

  return (
    <ConversationsClient
      key={`${organizationId}-${status}`}
      status={status as Doc<'conversations'>['status']}
      organizationId={organizationId}
      page={parseInt(page)}
      limit={20}
      priority={priority && priority.length > 0 ? priority : undefined}
      category={category && category.length > 0 ? category : undefined}
      search={search && search.length > 0 ? search : undefined}
    />
  );
}
