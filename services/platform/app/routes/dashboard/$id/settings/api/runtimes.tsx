import { createFileRoute } from '@tanstack/react-router';

import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { RuntimesSettings } from '@/app/features/settings/runtimes/runtimes-settings';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api/runtimes')({
  head: () => ({ meta: seo('apiKeys') }),
  component: ApiRuntimesPage,
});

function ApiRuntimesPage() {
  const { id: organizationId } = Route.useParams();
  const { t } = useT('runtimes');

  // Access is gated by the parent `api` route layout.
  return (
    <SettingsPage title={t('title')} description={t('description')}>
      <RuntimesSettings organizationId={organizationId} />
    </SettingsPage>
  );
}
