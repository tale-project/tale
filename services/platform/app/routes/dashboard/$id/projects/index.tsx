import { createFileRoute } from '@tanstack/react-router';

import {
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@/app/components/layout/adaptive-header';
import { PageLayout } from '@/app/components/layout/page-layout';
import { ProjectsTable } from '@/app/features/projects/components/projects-table';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/projects/')({
  head: () => ({
    meta: seo('projects'),
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('projects');
  return (
    <PageLayout
      organizationId={organizationId}
      header={
        <AdaptiveHeaderRoot standalone={false}>
          <AdaptiveHeaderTitle>{t('title')}</AdaptiveHeaderTitle>
        </AdaptiveHeaderRoot>
      }
    >
      <ProjectsTable organizationId={organizationId} />
    </PageLayout>
  );
}
