import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import type { Id } from '@/convex/_generated/dataModel';
import { ExecutionsClient } from '@/app/features/automations/executions/executions-client';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  triggeredBy: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const Route = createFileRoute(
  '/dashboard/$id/automations/$amId/executions',
)({
  validateSearch: searchSchema,
  component: ExecutionsPage,
});

function ExecutionsPage() {
  const { id: organizationId, amId } = Route.useParams();
  const automationId = amId as Id<'wfDefinitions'>;
  const { query, status, triggeredBy, dateFrom, dateTo } = Route.useSearch();

  return (
    <ExecutionsClient
      amId={automationId}
      organizationId={organizationId}
      searchTerm={query}
      status={status ? [status] : undefined}
      triggeredBy={triggeredBy ? [triggeredBy] : undefined}
      dateFrom={dateFrom}
      dateTo={dateTo}
    />
  );
}
