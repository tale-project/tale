import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ExecutionsTable } from '@/app/features/automations/executions/executions-table';
import { api } from '@/convex/_generated/api';
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
  loader: ({ context, params }) => {
    void context.queryClient.prefetchQuery(
      convexQuery(api.wf_executions.queries.approxCountExecutions, {
        wfDefinitionId: toId<'wfDefinitions'>(params.amId),
      }),
    );
  },
  component: ExecutionsPage,
});

function ExecutionsPage() {
  const { id: organizationId, amId } = Route.useParams();
  const automationId = toId<'wfDefinitions'>(amId);
  const { query, status, triggeredBy, dateFrom, dateTo } = Route.useSearch();

  return (
    <ExecutionsTable
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
