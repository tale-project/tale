'use client';

import { Alert } from '@tale/ui/alert';
import { Stack } from '@tale/ui/layout';
import { Plug } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { CredentialTable } from '@/app/features/settings/credentials/credential-table';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useUrlState } from '@/app/hooks/use-url-state';
import { useT } from '@/lib/i18n/client';

import {
  toConnectorVendor,
  connectorCredentialAdapter,
} from '../credential-adapter';
import { useConnectorCredentials, useConnectors } from '../hooks/queries';

/**
 * The connectors settings page: every credential the organization holds for a
 * shipped connector, as a table.
 *
 * The shipped catalog is not the page — it is step one of "Add credential",
 * where choosing a connector actually decides something. As a grid of sixteen
 * cards it made the two or three connectors an organization had actually
 * connected the hardest thing on the screen to find.
 *
 * `?connector=<slug>` still narrows the table to one connector, which is what
 * makes a connector linkable from anywhere else in the app — and what the OAuth
 * round trip comes back to.
 */
export function ConnectorsSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const connectorsQuery = useConnectors(organizationId);
  const credentialsQuery = useConnectorCredentials(organizationId);

  const [vendorFilter, setVendorFilter] = useState<string[]>([]);
  const { state, setState } = useUrlState({
    definitions: { connector: { default: null } },
  });
  const urlConnector = state.connector;

  // Seeded FROM the url, not bound to it: the facet is multi-select and the
  // param holds one slug, so binding them would silently drop the operator's
  // second choice. Once they touch the facet the param steps aside.
  useEffect(() => {
    if (urlConnector !== null) setVendorFilter([urlConnector]);
  }, [urlConnector]);

  const vendors = useMemo(
    () => (connectorsQuery.data ?? []).map(toConnectorVendor),
    [connectorsQuery.data],
  );

  if (!abilityLoading && ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccessDenied('connectors')} />;
  }

  return (
    <SettingsPage>
      <Stack gap={4}>
        {connectorsQuery.isError && (
          <Alert
            variant="destructive"
            description={t('connectors.catalog.listFailed', {
              error: mapCredentialError(connectorsQuery.error),
            })}
          />
        )}
        {/* An empty table and an unreadable one look identical; say which. */}
        {credentialsQuery.isError && (
          <Alert
            variant="destructive"
            description={t('credentials.listFailed', {
              error: mapCredentialError(credentialsQuery.error),
            })}
          />
        )}

        <CredentialTable
          organizationId={organizationId}
          vendors={vendors}
          credentials={credentialsQuery.data ?? []}
          adapter={connectorCredentialAdapter}
          isLoading={abilityLoading || credentialsQuery.isPending}
          labels={{
            vendorColumn: t('connectors.vendorColumn'),
            vendorFilter: t('connectors.vendorFilterLabel'),
            catalogSearch: t('connectors.searchPlaceholder'),
            catalogEmpty: t('connectors.catalog.emptyBody'),
            empty: {
              icon: Plug,
              title: tEmpty('connectors.title'),
              description: tEmpty('connectors.description'),
            },
          }}
          vendorFilter={vendorFilter}
          onVendorFilterChange={(next) => {
            setVendorFilter(next);
            if (urlConnector !== null) setState('connector', null);
          }}
        />
      </Stack>
    </SettingsPage>
  );
}
