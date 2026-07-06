import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ModelCatalogCard } from '@/app/features/settings/providers/components/model-catalog-card';
import { ProvidersSettingsSection } from '@/app/features/settings/providers/components/providers-settings-section';

export const Route = createFileRoute('/dashboard/$id/settings/providers/')({
  component: ProvidersIndexRoute,
});

function ProvidersIndexRoute() {
  const { id } = Route.useParams();

  return (
    <SettingsPage>
      <ProvidersSettingsSection organizationId={id} />
      <ModelCatalogCard
        organizationId={id}
        className="border-border border-t pt-8"
      />
    </SettingsPage>
  );
}
