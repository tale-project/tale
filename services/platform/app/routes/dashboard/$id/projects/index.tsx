import { createFileRoute } from '@tanstack/react-router';

import { ProjectsTable } from '@/app/features/projects/components/projects-table';

export const Route = createFileRoute('/dashboard/$id/projects/')({
  component: ProjectsPage,
});

function ProjectsPage() {
  const { id: organizationId } = Route.useParams();
  return <ProjectsTable organizationId={organizationId} />;
}
