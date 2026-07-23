import { createFileRoute } from '@tanstack/react-router';

import { PreferencesSettings } from '@/app/features/settings/personalization/components/preferences-settings';

export const Route = createFileRoute('/dashboard/$id/settings/personalization')(
  {
    component: PersonalizationRoute,
  },
);

function PersonalizationRoute() {
  const { id } = Route.useParams();
  return <PreferencesSettings organizationId={id} />;
}
