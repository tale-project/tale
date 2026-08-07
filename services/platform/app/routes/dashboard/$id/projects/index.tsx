import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ProjectsTable } from '@/app/features/projects/components/projects-table';
import { projectsOverviewArgs } from '@/app/features/projects/hooks/queries';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/projects/')({
  head: () => ({
    meta: seo('projects'),
  }),
  loader: ({ context, params }) => {
    // Warm the projects list so the table paints without a skeleton on first
    // nav. The args MUST match what ProjectsTable subscribes with or the cache
    // key misses — hence the shared builder rather than a hand-written object.
    // Its `asOf` is bucketed, so a bucket roll between loader and mount costs
    // one redundant fetch and self-heals.
    void context.queryClient.prefetchQuery(
      convexQuery(
        api.projects.queries.listProjectsOverview,
        projectsOverviewArgs(params.id, false),
      ),
    );
  },
  component: ProjectsPage,
});

function ProjectsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('projects');
  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <AdaptiveHeaderRoot showBorder standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
      }
    >
      <ProjectsTable organizationId={organizationId} />
    </PageLayout>
  );
}
