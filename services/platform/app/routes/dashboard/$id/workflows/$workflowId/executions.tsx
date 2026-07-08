import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ExecutionsTable } from '@/app/features/workflows/executions/executions-table';
import { seo } from '@/lib/utils/seo';
import { urlParamToSlug } from '@/lib/utils/workflow-slug';

const searchSchema = z.object({
  query: z.string().optional(),
  status: z.string().optional(),
  triggeredBy: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const Route = createFileRoute(
  '/dashboard/$id/workflows/$workflowId/executions',
)({
  head: () => ({
    meta: seo('workflowExecutions'),
  }),
  validateSearch: searchSchema,
  component: ExecutionsPage,
});

function ExecutionsPage() {
  const { id: organizationId, workflowId } = Route.useParams();
  const { query, status, triggeredBy, dateFrom, dateTo } = Route.useSearch();
  const workflowSlug = urlParamToSlug(workflowId);

  return (
    <ExecutionsTable
      workflowId={workflowSlug}
      organizationId={organizationId}
      searchTerm={query}
      status={status ? status.split(',') : undefined}
      triggeredBy={triggeredBy}
      dateFrom={dateFrom}
      dateTo={dateTo}
    />
  );
}
