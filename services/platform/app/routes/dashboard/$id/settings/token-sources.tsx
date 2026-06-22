import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { TokenSourcesManager } from '@/app/features/settings/token-sources/components/token-sources-manager';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/token-sources')({
  head: () => ({
    meta: seo('tokenSources'),
  }),
  component: TokenSourcesLayout,
});

function TokenSourcesLayout() {
  const { id } = Route.useParams();
  const { t } = useT('accessDenied');
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  if (!abilityLoading && ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={t('integrations')} />;
  }

  return (
    <SettingsPage>
      <SettingsSection
        title={tNav('tokenSources')}
        description={tSettings('menu.tokenSources.description')}
      >
        <TokenSourcesManager organizationId={id} />
      </SettingsSection>
    </SettingsPage>
  );
}
