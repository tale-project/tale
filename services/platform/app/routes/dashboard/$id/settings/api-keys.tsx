import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ApiKeysTable } from '@/app/features/settings/api-keys/components/api-keys-table';
import { useApiKeys } from '@/app/features/settings/api-keys/hooks/use-api-keys';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api-keys')({
  head: () => ({
    meta: seo('apiKeys'),
  }),
  component: ApiKeysSettingsPage,
});

function ApiKeysSettingsPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('accessDenied');
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  const ability = useAbility();
  const abilityLoading = useAbilityLoading();

  const { data: apiKeys } = useApiKeys(organizationId);

  // Access is only knowable once the ability has loaded; until then the real
  // page (whose `ApiKeysTable` DataTable self-skeletonizes via its count-aware
  // state machine) stands in — no denied-flash on warm entry and no separate
  // skeleton whose column widths could drift from the real table.
  if (!abilityLoading && ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={t('apiKeys')} />;
  }

  return (
    <SettingsPage
      title={tNav('apiKeys')}
      description={tSettings('menu.apiKeys.description')}
    >
      <ApiKeysTable apiKeys={apiKeys} organizationId={organizationId} />
    </SettingsPage>
  );
}
