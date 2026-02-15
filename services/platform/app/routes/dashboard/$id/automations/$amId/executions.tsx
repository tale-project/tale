import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ExecutionsClient } from '@/app/features/automations/executions/executions-client';
import { toId } from '@/convex/lib/type_cast_helpers';
import { seo } from '@/lib/utils/seo';

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
  head: () => ({
    meta: seo('automationExecutions'),
  }),
  validateSearch: searchSchema,
  component: ExecutionsPage,
});

function ExecutionsPage() {
  const { id: organizationId, amId } = Route.useParams();
  const automationId = toId<'wfDefinitions'>(amId);
  const { query, status, triggeredBy, dateFrom, dateTo } = Route.useSearch();

  return (
    <ExecutionsClient
      amId={automationId}
      organizationId={organizationId}
      searchTerm={query}
      status={status ? [status] : undefined}
      triggeredBy={triggeredBy}
      dateFrom={dateFrom}
      dateTo={dateTo}
    />
  );
}
