import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { z } from 'zod';

import { Approvals } from '@/app/features/approvals/components/approvals';
import {
  useApproxApprovalCountByStatus,
  useListApprovalsPaginated,
} from '@/app/features/approvals/hooks/queries';
import { api } from '@/convex/_generated/api';

const VALID_STATUSES = ['pending', 'resolved'] as const;
type ValidStatus = (typeof VALID_STATUSES)[number];

function isValidStatus(value: string): value is ValidStatus {
  return VALID_STATUSES.some((s) => s === value);
}

const searchSchema = z.object({
  search: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/approvals/$status')({
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => {
    if (!isValidStatus(params.status)) {
      throw notFound();
    }
  },
  loader: ({ context, params }) => {
    if (isValidStatus(params.status)) {
      const isPending = params.status === 'pending';

      void context.queryClient.prefetchQuery(
        convexQuery(api.approvals.queries.listApprovalsPaginated, {
          organizationId: params.id,
          ...(isPending
            ? { status: 'pending', resourceType: 'product_recommendation' }
            : {
                resourceType: 'product_recommendation',
                excludeStatus: 'pending',
              }),
          paginationOpts: { numItems: 30, cursor: null },
        }),
      );
      void context.queryClient.prefetchQuery(
        convexQuery(api.approvals.queries.approxCountApprovalsByStatus, {
          organizationId: params.id,
          status: params.status,
        }),
      );
    }
  },
  component: ApprovalsStatusPage,
});

function ApprovalsStatusPage() {
  const { id: organizationId, status } = Route.useParams();
  const { search } = Route.useSearch();
  const isPending = status === 'pending';
  const resolvedStatus: ValidStatus = isPending ? 'pending' : 'resolved';

  const { data: approxCount } = useApproxApprovalCountByStatus(
    organizationId,
    resolvedStatus,
  );

  const paginatedResult = useListApprovalsPaginated({
    organizationId,
    ...(isPending
      ? { status: 'pending', resourceType: 'product_recommendation' }
      : { resourceType: 'product_recommendation', excludeStatus: 'pending' }),
    initialNumItems: 30,
  });

  return (
    <Approvals
      key={`${organizationId}-${status}`}
      status={resolvedStatus}
      search={search}
      paginatedResult={paginatedResult}
      approxCount={approxCount}
    />
  );
}
