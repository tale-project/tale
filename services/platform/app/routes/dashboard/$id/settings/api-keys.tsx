import { createFileRoute } from '@tanstack/react-router';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ApiKeysTable } from '@/app/features/settings/api-keys/components/api-keys-table';
import { useApiKeys } from '@/app/features/settings/api-keys/hooks/use-api-keys';
import { useAbility } from '@/app/hooks/use-ability';
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

  const ability = useAbility();

  const { data: apiKeys } = useApiKeys(organizationId);

  if (ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={t('apiKeys')} />;
  }

  return <ApiKeysTable apiKeys={apiKeys} organizationId={organizationId} />;
}
