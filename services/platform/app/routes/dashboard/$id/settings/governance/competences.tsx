import { createFileRoute } from '@tanstack/react-router';

import { CompetencesPage } from '@/app/features/settings/governance/competences/competences-page';

export const Route = createFileRoute(
  '/dashboard/$id/settings/governance/competences',
)({
  component: CompetencesRoute,
});

function CompetencesRoute() {
  const { id: organizationId } = Route.useParams();
  // The page owns its own `SettingsPage` frame — bounded height and full
  // width, so the register's table scrolls inside a fixed frame like Trash.
  return <CompetencesPage organizationId={organizationId} />;
}
