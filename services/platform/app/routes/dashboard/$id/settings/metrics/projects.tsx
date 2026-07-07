import { EmptyState } from '@tale/ui/empty-state';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { z } from 'zod';

import {
  metricsPeriodSearchSchema,
  metricsPeriodToParam,
  parseMetricsPeriodDays,
  type MetricsPeriodDays,
} from '@/app/components/metrics/metrics-period';
import { Select } from '@/app/components/ui/forms/select';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import {
  ProjectMetricsPage,
  type PeriodDays,
} from '@/app/features/tasks/components/project-metrics-page';
import { useT } from '@/lib/i18n/client';

export const searchSchema = metricsPeriodSearchSchema.extend({
  project: z.string().optional(),
});

export const Route = createFileRoute(
  '/dashboard/$id/settings/metrics/projects',
)({
  validateSearch: searchSchema,
  component: ProjectsMetricsRoute,
});

function ProjectsMetricsRoute() {
  const { id: organizationId } = Route.useParams();
  const { period, project: projectParam } = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useT('metrics');

  const { projects, isLoading: projectsLoading } = useProjects(organizationId);
  const periodDays: PeriodDays = parseMetricsPeriodDays(period);

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

  return (
    <SettingsPage>
      <Skeletonize loading={projectsLoading}>
        <div className="mb-4 w-full max-w-sm">
          <Select
            aria-label={t('projects.selectLabel')}
            placeholder={t('projects.selectPlaceholder')}
            options={projectOptions}
            value={selectedProjectId ?? ''}
            onValueChange={handleSelectProject}
          />
        </div>

        {selectedProjectId ? (
          <ProjectMetricsPage
            organizationId={organizationId}
            projectId={selectedProjectId}
            periodDays={periodDays}
            onChangePeriod={handleChangePeriod}
            showBackLink={false}
          />
        ) : (
          <EmptyState
            title={t('projects.emptyTitle')}
            description={t('projects.emptyDescription')}
          />
        )}
      </Skeletonize>
    </SettingsPage>
  );
}
