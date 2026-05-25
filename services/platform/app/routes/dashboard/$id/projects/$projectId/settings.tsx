import { createFileRoute } from '@tanstack/react-router';

import { ProjectSettingsTab } from '@/app/features/projects/components/project-settings-tab';
import { asProjectId } from '@/app/features/projects/hooks/use-project-id-param';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/settings',
)({
  component: ProjectSettingsPage,
});

function ProjectSettingsPage() {
  const { id: organizationId, projectId } = Route.useParams();
  return (
    <ProjectSettingsTab
      organizationId={organizationId}
      projectId={asProjectId(projectId)}
    />
  );
}
