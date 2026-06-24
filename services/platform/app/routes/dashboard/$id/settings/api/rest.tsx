import { createFileRoute } from '@tanstack/react-router';

import { CopyableText } from '@/app/components/ui/data-display/copyable-field';
import { ApiKeysTable } from '@/app/features/settings/api-keys/components/api-keys-table';
import { useApiKeys } from '@/app/features/settings/api-keys/hooks/use-api-keys';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useT } from '@/lib/i18n/client';
import { seo } from '@/lib/utils/seo';

export const Route = createFileRoute('/dashboard/$id/settings/api/rest')({
  head: () => ({ meta: seo('apiKeys') }),
  component: ApiRestPage,
});

function ApiRestPage() {
  const { id: organizationId } = Route.useParams();
  const { t: tNav } = useT('navigation');
  const { t: tSettings } = useT('settings');

  const { data: apiKeys } = useApiKeys(organizationId);

  // Access is gated by the parent `api` route layout. Section title (not a
  // page title) — the settings rail already names the page.
  // Not `narrow`: the keys table's column floor (~676px) doesn't fit the
  // 544px column — table-dominated pages take the full content width.
  return (
    <SettingsPage>
      <SettingsSection
        title={tNav('apiKeys')}
        description={
          // The organization ID lives here (not in org settings) because it's
          // what callers reference when authenticating against the API. Copy
          // affordance reuses the shared `CopyableText` pill.
          <div className="flex flex-col gap-2">
            <span>{tSettings('menu.apiKeys.description')}</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span>{tSettings('organization.organizationId')}:</span>
              <CopyableText value={organizationId} />
            </div>
          </div>
        }
      >
        <ApiKeysTable apiKeys={apiKeys} organizationId={organizationId} />
      </SettingsSection>
    </SettingsPage>
  );
}
