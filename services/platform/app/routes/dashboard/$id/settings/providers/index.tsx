import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { ModelCatalogCard } from '@/app/features/settings/providers/components/model-catalog-card';
import { ProvidersTable } from '@/app/features/settings/providers/components/providers-table';
import { useT } from '@/lib/i18n/client';

export const Route = createFileRoute('/dashboard/$id/settings/providers/')({
  component: ProvidersIndexRoute,
});

function ProvidersIndexRoute() {
  const { id } = Route.useParams();
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  return (
    <SettingsPage>
      <SettingsSection
        title={tNav('providers')}
        description={tSettings('menu.providers.description')}
      >
        <ProvidersTable organizationId={id} />
      </SettingsSection>
      <ModelCatalogCard
        organizationId={id}
        className="border-border border-t pt-8"
      />
    </SettingsPage>
  );
}
