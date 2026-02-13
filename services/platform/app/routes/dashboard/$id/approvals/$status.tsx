import { createFileRoute, notFound } from '@tanstack/react-router';
import { z } from 'zod';

import { ApprovalsClient } from '@/app/features/approvals/components/approvals-client';
import { useListApprovalsPaginated } from '@/app/features/approvals/hooks/queries';

const VALID_STATUSES = ['pending', 'resolved'] as const;

const searchSchema = z.object({
  search: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/approvals/$status')({
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => {
    if (!VALID_STATUSES.some((s) => s === params.status)) {
      throw notFound();
    }
  },
  component: ApprovalsStatusPage,
});

function ApprovalsStatusPage() {
  const { id: organizationId, status } = Route.useParams();
  const { search } = Route.useSearch();
  const isPending = status === 'pending';

  const paginatedResult = useListApprovalsPaginated({
    organizationId,
    ...(isPending
      ? { status: 'pending', resourceType: 'product_recommendation' }
      : { resourceType: 'product_recommendation', excludeStatus: 'pending' }),
    initialNumItems: 30,
  });

  return (
    <ApprovalsClient
      key={`${organizationId}-${status}`}
      status={isPending ? 'pending' : 'resolved'}
      organizationId={organizationId}
      search={search}
      paginatedResult={paginatedResult}
    />
  );
}
