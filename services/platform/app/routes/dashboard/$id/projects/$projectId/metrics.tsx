import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { useCallback } from 'react';

import { ContentArea } from '@/app/components/layout/content-area';
import {
  metricsPeriodSearchSchema,
  metricsPeriodToParam,
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { ProjectMetricsPage } from '@/app/features/tasks/components/project-metrics-page';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/metrics',
)({
  // No `head` override here (unlike the other project tabs): the parent
  // `$projectId` layout route already sets the document title to the loaded
  // project's own name (#2647). Overriding it with the generic
  // `seo('projects')` — the *list* page's title — defeated that per-project
  // title on this one tab.
  validateSearch: metricsPeriodSearchSchema,
  component: ProjectMetricsRoute,
});

// Access mirrors the tasks route: no client-side ability gate. The page
// currently renders only its empty state (its rollup query died with the
// `taskMetricsDaily` table in the 0.4 baseline reset — no org data is read),
// and the rebuilt rollup query must enforce project read access server-side
// exactly as `getProjectTaskMetrics` did.
function ProjectMetricsRoute() {
  const { id: organizationId, projectId } = Route.useParams();
  const { period } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useT('tasks');

  const periodDays: MetricsPeriodDays = parseMetricsPeriodDays(period);

  const handleChangePeriod = useCallback(
    (next: MetricsPeriodDays) => {
      void navigate({
        to: '/dashboard/$id/projects/$projectId/metrics',
        params: { id: organizationId, projectId },
        search: { period: metricsPeriodToParam(next) },
        replace: true,
      });
    },
    [navigate, organizationId, projectId],
  );

  return (
    // Full-pane width on purpose — not the `narrow` measure the other project
    // tabs share: `ProjectMetricsPage` lays out a four-up stat-card grid plus
    // two-column chart grids, all designed for more room than the `max-w-3xl`
    // configuration measure. It is the same justification Settings → Metrics
    // documents for rendering on a `SettingsPage fullWidth`. `py-4` keeps the
    // vertical rhythm of the sibling project tabs.
    <ContentArea gap={4} className="py-4">
      {/* Metrics is a sub-view of Tasks (no tab of its own), so lead with a
          back link to the tasks list — otherwise there's no way back. */}
      <Link
        to="/dashboard/$id/projects/$projectId/tasks"
        params={{ id: organizationId, projectId }}
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t('title')}
      </Link>
      <ProjectMetricsPage
        projectId={asProjectId(projectId)}
        periodDays={periodDays}
        onChangePeriod={handleChangePeriod}
      />
    </ContentArea>
  );
}
