import { createFileRoute, notFound } from '@tanstack/react-router';
import { z } from 'zod';
import { ApprovalsClient } from '@/app/features/approvals/components/approvals-client';

const VALID_STATUSES = ['pending', 'resolved'] as const;
type ApprovalStatus = (typeof VALID_STATUSES)[number];

const searchSchema = z.object({
  search: z.string().optional(),
  page: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/approvals/$status')({
  validateSearch: searchSchema,
  beforeLoad: ({ params }) => {
    if (!VALID_STATUSES.includes(params.status as ApprovalStatus)) {
      throw notFound();
    }
  },
  component: ApprovalsStatusPage,
});

function ApprovalsStatusPage() {
  const { id: organizationId, status } = Route.useParams();
  const { search } = Route.useSearch();

  return (
    <ApprovalsClient
      key={`${status}-${search}`}
      status={status as ApprovalStatus}
      organizationId={organizationId}
      search={search}
    />
  );
}
