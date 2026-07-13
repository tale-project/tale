import { EmptyState } from '@tale/ui/empty-state';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { BarChart3 } from 'lucide-react';
import { useCallback } from 'react';
import { z } from 'zod';

import { MetricSelect } from '@/app/components/metrics/metric-select';
import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
import {
  metricsPeriodSearchSchema,
  metricsPeriodToParam,
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ProjectMetricsPage } from '@/app/features/tasks/components/project-metrics-page';
import { useT } from '@/lib/i18n/client';

const searchSchema = metricsPeriodSearchSchema.extend({
  project: z.string().optional(),
});

export const Route = createFileRoute(
  '/dashboard/$id/settings/metrics/projects',
)({
  validateSearch: searchSchema,
  component: ProjectsMetricsRoute,
});

/**
 * Project metrics stay project-scoped (the rollups are per project), so this
 * section is a project picker over the SAME `ProjectMetricsPage` the project's
 * own Metrics sub-view renders — one component, two homes (#2382). The picker
 * lives in the page toolbar next to the period select, and the header stays
 * identical whether or not a project is selected.
 */
function ProjectsMetricsRoute() {
  const { id: organizationId } = Route.useParams();
  const { period, project: projectParam } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useT('metrics');
  const { t: tTasks } = useT('tasks');

  const { projects, isLoading: projectsLoading } = useProjects(organizationId);
  const periodDays: MetricsPeriodDays = parseMetricsPeriodDays(period);

  const projectOptions = projects.map((p) => ({
    value: p._id,
    label: p.name,
  }));

  const selectedProjectId = projectParam
    ? asProjectId(projectParam)
    : undefined;

  const handleSelectProject = useCallback(
    (projectId: string) => {
      void navigate({
        to: '/dashboard/$id/settings/metrics/projects',
        params: { id: organizationId },
        search: (prev) => ({
          ...prev,
          project: projectId || undefined,
        }),
        replace: true,
      });
    },
    [navigate, organizationId],
  );

  const handleChangePeriod = useCallback(
    (next: MetricsPeriodDays) => {
      void navigate({
        to: '/dashboard/$id/settings/metrics/projects',
        params: { id: organizationId },
        search: (prev) => ({
          ...prev,
          period: metricsPeriodToParam(next),
        }),
        replace: true,
      });
    },
    [navigate, organizationId],
  );

  const projectPicker = (
    <MetricSelect
      aria-label={t('projects.selectLabel')}
      placeholder={t('projects.selectPlaceholder')}
      options={projectOptions}
      value={selectedProjectId ?? ''}
      onValueChange={handleSelectProject}
      widthClassName="w-56"
    />
  );

  return (
    // `fullWidth`: `ProjectMetricsPage` lays its charts out on a two-column
    // grid designed for the full pane, wider than the `max-w-3xl` standard
    // settings measure (#2567).
    <SettingsPage fullWidth>
      <Skeletonize loading={projectsLoading}>
        {selectedProjectId ? (
          <ProjectMetricsPage
            as="h3"
            toolbarStart={projectPicker}
            projectId={selectedProjectId}
            periodDays={periodDays}
            onChangePeriod={handleChangePeriod}
          />
        ) : (
          <MetricsLayout
            as="h3"
            title={tTasks('metrics.title')}
            description={tTasks('metrics.description')}
            toolbar={projectPicker}
          >
            <EmptyState
              icon={BarChart3}
              title={t('projects.emptyTitle')}
              description={t('projects.emptyDescription')}
            />
          </MetricsLayout>
        )}
      </Skeletonize>
    </SettingsPage>
  );
}
