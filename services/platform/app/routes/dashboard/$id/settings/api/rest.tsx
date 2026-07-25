import { createFileRoute } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';

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
  // Standard SettingsPage measure (max-w-3xl): the keys table's ~676px column
  // floor fits it; the table stays non-sticky per #2381.
  return (
    <SettingsPage>
      <SettingsSection
        title={tNav('apiKeys')}
        description={
          // API callers need the organization ID, but the value itself lives
          // with the org's other identity fields — link there instead of
          // duplicating the field on two pages.
          <span>
            {tSettings('menu.apiKeys.description')}{' '}
            <Link
              to="/dashboard/$id/settings/organization"
              params={{ id: organizationId }}
              className="text-primary hover:underline"
            >
              {tSettings('organization.organizationId')}
            </Link>
          </span>
        }
      >
        <ApiKeysTable apiKeys={apiKeys} organizationId={organizationId} />
      </SettingsSection>
    </SettingsPage>
  );
}
