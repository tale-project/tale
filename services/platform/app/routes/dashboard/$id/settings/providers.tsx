import { Outlet, createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { ProvidersTable } from '@/app/features/settings/providers/components/providers-table';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/providers')({
  head: () => ({
    meta: seo('providers'),
  }),
  component: ProvidersLayout,
});

function ProvidersLayout() {
  const { id } = Route.useParams();
  const { t } = useT('accessDenied');
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  if (abilityLoading) {
    // Render the real providers table inside the SAME section chrome the
    // index/detail routes use, so the section header is already in place when
    // the table data resolves. The `DataTable` owns its own loading skeleton
    // (driven by `useListPage`'s `isLoading`), so no bespoke skeleton is
    // needed — the table swaps in under a stable header.
    return (
      <SettingsPage narrow>
        <SettingsSection
          title={tNav('providers')}
          description={tSettings('menu.providers.description')}
        >
          <ProvidersTable organizationId={id} />
        </SettingsSection>
      </SettingsPage>
    );
  }

  if (ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={t('integrations')} />;
  }

  return <Outlet />;
}
