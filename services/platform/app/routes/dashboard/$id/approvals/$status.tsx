import { createFileRoute, notFound, useLocation } from '@tanstack/react-router';
import { useMemo } from 'react';
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
    // Array.includes() on readonly tuple requires exact type — cast required for string param
    if (!VALID_STATUSES.includes(params.status as ApprovalStatus)) {
      throw notFound();
    }
  },
  component: ApprovalsStatusPage,
});

function ApprovalsStatusPage() {
  const location = useLocation();
  const { search } = Route.useSearch();

  const { organizationId, status } = useMemo(() => {
    const pathParts = location.pathname.split('/');
    const approvalsIndex = pathParts.indexOf('approvals');
    return {
      organizationId: pathParts[2],
      // URL path segment is string — cast required after beforeLoad validation
      status: pathParts[approvalsIndex + 1] as ApprovalStatus,
    };
  }, [location.pathname]);

  return (
    <ApprovalsClient
      key={`${organizationId}-${status}-${search}`}
      status={status}
      organizationId={organizationId}
      search={search}
    />
  );
}
