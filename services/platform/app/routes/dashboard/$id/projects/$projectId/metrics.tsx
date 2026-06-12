import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import {
  ProjectMetricsPage,
  type PeriodDays,
} from '@/app/features/tasks/components/project-metrics-page';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  period: z.enum(['7', '30', '90']).optional(),
});

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/metrics',
)({
  head: () => ({
    meta: seo('projects'),
  }),
  validateSearch: searchSchema,
  component: ProjectMetricsRoute,
});

// Access mirrors the tasks route: no client-side ability gate — the backing
// query (getProjectTaskMetrics) enforces project read access server-side.
function ProjectMetricsRoute() {
  const { id: organizationId, projectId } = Route.useParams();
  const { period } = Route.useSearch();
  const navigate = useNavigate();

  const periodDays: PeriodDays = period === '7' ? 7 : period === '90' ? 90 : 30;

  const handleChangePeriod = useCallback(
    (next: PeriodDays) => {
      const periodParam: '7' | '30' | '90' =
        next === 7 ? '7' : next === 90 ? '90' : '30';
      void navigate({
        to: '/dashboard/$id/projects/$projectId/metrics',
        params: { id: organizationId, projectId },
        search: { period: periodParam },
        replace: true,
      });
    },
    [navigate, organizationId, projectId],
  );

  return (
    <ProjectMetricsPage
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
      periodDays={periodDays}
      onChangePeriod={handleChangePeriod}
    />
  );
}
