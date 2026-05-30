import { Outlet, createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { ProvidersPageSkeleton } from '@/app/features/settings/providers/components/providers-page-skeleton';
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
  const { t } = useT('accessDenied');
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  if (abilityLoading) {
    // Render the access skeleton inside the SAME `SettingsPage` chrome the
    // index/detail routes use, so the title + description header is already
    // in place when the table data resolves — the table swaps in under a
    // stable header instead of pushing it down when the real page mounts.
    return (
      <SettingsPage
        title={tNav('providers')}
        description={tSettings('menu.providers.description')}
      >
        <ProvidersPageSkeleton />
      </SettingsPage>
    );
  }

  if (ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={t('integrations')} />;
  }

  return <Outlet />;
}
