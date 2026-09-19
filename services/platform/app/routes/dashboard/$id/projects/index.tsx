import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { PageLayout } from '@tale/ui/page-layout';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from 'react';
import { z } from 'zod';

import { ProjectsTable } from '@/app/features/projects/components/projects-table';
import { projectsOverviewArgs } from '@/app/features/projects/hooks/queries';
import {
  parseAudienceFilter,
  serializeAudienceFilter,
} from '@/app/features/settings/teams/lib/audience-filter';
import { projectsOverviewQuery } from '@/app/lib/backend/projects';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

const searchSchema = z.object({
  /**
   * The Teams filter: comma-separated team ids and/or the audience tokens
   * `org` (organization-wide projects) and `mine` (the viewer's own teams).
   * In the URL so a filtered view survives a reload and can be shared.
   */
  teams: z.string().optional(),
});

export const Route = createFileRoute('/dashboard/$id/projects/')({
  head: () => ({
    meta: seo('projects'),
  }),
  validateSearch: searchSchema,
  loader: ({ context, params }) => {
    // Warm the projects list so the table paints without a skeleton on first
    // nav. The args MUST match what ProjectsTable subscribes with or the cache
    // key misses — hence the shared builder (the same one the hook's adapter
    // row uses). Its `asOf` is bucketed, so a bucket roll between loader and
    // mount costs one redundant fetch and self-heals.
    void context.queryClient.prefetchQuery(
      projectsOverviewQuery(projectsOverviewArgs(params.id, false)),
    );
  },
  component: ProjectsPage,
});

function ProjectsPage() {
  const { id: organizationId } = Route.useParams();
  const { teams } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { t } = useT('projects');
  const teamFilter = useMemo(() => parseAudienceFilter(teams), [teams]);
  const handleTeamFilterChange = useCallback(
    (teamIds: string[]) => {
      void navigate({
        search: (prev) => ({
          ...prev,
          teams: serializeAudienceFilter(teamIds),
        }),
        replace: true,
      });
    },
    [navigate],
  );
  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <AdaptiveHeaderRoot showBorder standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
      }
    >
      <ProjectsTable
        organizationId={organizationId}
        teamFilter={teamFilter}
        onTeamFilterChange={handleTeamFilterChange}
      />
    </PageLayout>
  );
}
