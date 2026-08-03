import { EmptyState } from '@tale/ui/empty-state';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { BarChart3 } from 'lucide-react';
import { useCallback, useEffect } from 'react';
import { z } from 'zod';

import { MetricsLayout } from '@/app/components/metrics/metrics-layout';
import {
  metricsPeriodSearchSchema,
  metricsPeriodToParam,
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import { MetricsPeriodSelect } from '@/app/components/metrics/metrics-period-select';
import { soleScopeValue } from '@/app/components/metrics/metrics-scope';
import { MetricsScopeSelect } from '@/app/components/metrics/metrics-scope-select';
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
 * is the page's SUBJECT, so it sits in the toolbar as its own always-visible
 * select left of the filter button — never as a section inside it, where a
 * required choice reads as optional and the live scope is unreadable. With a
 * single project the page scopes itself rather than parking on an empty state.
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

  // The one project in a single-project org is the scope — an empty pane behind
  // a picker teaches nothing. Runs as an effect (not a redirect in the loader)
  // because the project list is a live client query.
  const autoScopeId = soleScopeValue(
    projectOptions,
    selectedProjectId,
    projectsLoading,
  );
  useEffect(() => {
    if (autoScopeId) handleSelectProject(autoScopeId);
  }, [autoScopeId, handleSelectProject]);

  const scopeSelect = (
    <MetricsScopeSelect
      label={t('projects.selectLabel')}
      options={projectOptions}
      value={selectedProjectId}
      onValueChange={handleSelectProject}
      placeholder={t('projects.selectPlaceholder')}
      searchPlaceholder={t('projects.searchPlaceholder')}
      emptyText={t('projects.searchEmpty')}
    />
  );

  // `fullWidth`: `ProjectMetricsPage` lays its charts out on a two-column
  // grid designed for the full pane, wider than the `max-w-3xl` standard
  // settings measure (#2567). Empty path also uses `fitToContainer` so
  // EmptyState can vertically center in the remaining pane (Connectors
  // pattern); the selected-project path stays content-sized so charts
  // scroll with the outer settings scroller.
  if (selectedProjectId) {
    return (
      <SettingsPage fullWidth>
        <Skeletonize loading={projectsLoading}>
          <ProjectMetricsPage
            scopeControl={scopeSelect}
            projectId={selectedProjectId}
            periodDays={periodDays}
            onChangePeriod={handleChangePeriod}
          />
        </Skeletonize>
      </SettingsPage>
    );
  }

  return (
    <SettingsPage fullWidth fitToContainer>
      <Skeletonize
        loading={projectsLoading}
        className="flex min-h-0 flex-1 flex-col"
      >
        <MetricsLayout
          as="h3"
          title={tTasks('metrics.title')}
          description={tTasks('metrics.description')}
          toolbar={
            <>
              {scopeSelect}
              <MetricsPeriodSelect
                value={metricsPeriodToParam(periodDays)}
                onValueChange={(v) =>
                  handleChangePeriod(parseMetricsPeriodDays(v))
                }
              />
            </>
          }
          className="min-h-0 flex-1"
        >
          <EmptyState
            icon={BarChart3}
            title={t('projects.emptyTitle')}
            description={t('projects.emptyDescription')}
            className="min-h-0"
          />
        </MetricsLayout>
      </Skeletonize>
    </SettingsPage>
  );
}
