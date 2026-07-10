import { createFileRoute } from '@tanstack/react-router';

import { ProjectsPage } from '@/app/pages/platform/projects-page';

export const Route = createFileRoute('/platform/projects')({
  component: ProjectsPage,
});
