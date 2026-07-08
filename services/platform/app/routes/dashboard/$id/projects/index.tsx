import { convexQuery } from '@convex-dev/react-query';
import { createFileRoute } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ProjectsTable } from '@/app/features/projects/components/projects-table';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/projects/')({
  head: () => ({
    meta: seo('projects'),
  }),
  loader: ({ context, params }) => {
    // Warm the projects list so the table paints without a skeleton on first
    // nav. ProjectsTable mounts useProjects with includeArchived:false, so the
    // args must match that exactly or the cache key misses.
    void context.queryClient.prefetchQuery(
      convexQuery(api.projects.queries.listProjects, {
        organizationId: params.id,
        includeArchived: false,
      }),
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
