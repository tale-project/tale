import { createFileRoute } from '@tanstack/react-router';

import { ProjectTabSkeleton } from '@/app/features/projects/components/project-tab-skeleton';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';
import { lazyComponent } from '@/lib/utils/lazy-component';

const ProjectAgentsTab = lazyComponent(
  () =>
    import('@/app/features/projects/components/project-agents-tab').then(
      (mod) => ({ default: mod.ProjectAgentsTab }),
    ),
  // Show the layout-shaped skeleton while the tab's JS chunk loads, so the
  // content frame doesn't go blank between navigation and chunk-ready.
  { loading: () => <ProjectTabSkeleton /> },
);

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/agents',
)({
  component: ProjectAgentsPage,
});

function ProjectAgentsPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    <ProjectAgentsTab
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
    />
  );
}
