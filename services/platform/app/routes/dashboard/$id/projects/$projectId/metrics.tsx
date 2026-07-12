import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import {
  ProjectMetricsPage,
  type PeriodDays,
} from '@/app/features/tasks/components/project-metrics-page';

export const searchSchema = z.object({
  // The router parses a bare `?period=90` as the JSON number 90, which fails a
  // plain string enum and crashes the page (issue #2033). Coerce to a string
  // first, then fall back to the default window for any out-of-range value so a
  // shared/bookmarked URL never renders the error boundary.
  period: z.coerce
    .string()
    .pipe(z.enum(['7', '30', '90']))
    .catch('30')
    .optional(),
});

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/metrics',
)({
  // No `head` override here (unlike the other project tabs): the parent
  // `$projectId` layout route already sets the document title to the loaded
  // project's own name (#2647). Overriding it with the generic
  // `seo('projects')` — the *list* page's title — defeated that per-project
  // title on this one tab.
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
