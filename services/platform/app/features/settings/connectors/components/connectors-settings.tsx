'use client';

import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { Plug } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { CredentialTable } from '@/app/features/settings/credentials/credential-table';
import { credentialFailureDetail } from '@/app/features/settings/credentials/map-credential-error';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useListReadRecovery } from '@/app/hooks/use-list-read-recovery';
import { useUrlState } from '@/app/hooks/use-url-state';
import { readStateOf } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';

import {
  toConnectorVendor,
  connectorCredentialAdapter,
} from '../credential-adapter';
import { useConnectorCredentials, useConnectors } from '../hooks/queries';
import { OauthAppsCard } from './oauth-apps-card';

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
 *
 * A failed read never reads as an empty one (#4831): a catalog that never
 * loaded is named above the table and in the Add credential picker, with Try
 * again; a credential list that never loaded is the table's error state with
 * its retry, and rows a failed refresh left stay under a notice.
 */
export function ConnectorsSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { t: tNav } = useT('navigation');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const connectorsQuery = useConnectors(organizationId);
  const credentialsQuery = useConnectorCredentials(organizationId);
  const catalogRead = readStateOf(connectorsQuery);
  const credentialsRead = readStateOf(credentialsQuery);
  const { refetch: refetchConnectors } = connectorsQuery;
  const { refetch: refetchCredentials } = credentialsQuery;
  const retryCatalog = () => void refetchConnectors();
  const retryCredentials = () => void refetchCredentials();
  const { regionRef, retryRead, focusRegion } =
    useListReadRecovery<HTMLElement>({
      error: credentialsQuery.error,
      results: credentialsQuery.data ?? [],
      retry: retryCredentials,
    });

  // Why the catalog read failed, kept through the retry that resets the
  // read's error: the notice keeps its words while Try again runs.
  const catalogFailureRef = useRef<string | undefined>(undefined);
  if (connectorsQuery.isError) {
    catalogFailureRef.current = credentialFailureDetail(connectorsQuery.error);
  }
  const catalogFailureMessage = [
    t('connectors.catalog.listFailed'),
    catalogFailureRef.current,
  ]
    .filter(Boolean)
    .join(' ');

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
      <SettingsSection
        ref={regionRef}
        tabIndex={-1}
        className="outline-none"
        title={tNav('connectors')}
        description={t('connectors.sectionDescription')}
      >
        {(catalogRead.unavailable || catalogRead.stale) && (
          <CatalogLoadError
            // Each failure is announced again; Try again keeps its node, and
            // the focus on it, while a retry runs.
            failureKey={catalogRead.failureCount}
            onFocusLost={focusRegion}
            message={catalogFailureMessage}
            onRetry={retryCatalog}
            isRetrying={catalogRead.retrying}
          />
        )}
        {/* Rows a failed refresh left stay, and the failure is named above
            them. A list that never loaded is the table's own error state. */}
        {credentialsRead.stale && (
          <CatalogLoadError
            failureKey={credentialsRead.failureCount}
            onFocusLost={focusRegion}
            message={t('credentials.refreshFailed')}
            onRetry={retryCredentials}
            isRetrying={credentialsRead.retrying}
          />
        )}

        <CredentialTable
          organizationId={organizationId}
          vendors={vendors}
          credentials={credentialsQuery.data ?? []}
          adapter={connectorCredentialAdapter}
          isLoading={abilityLoading || credentialsQuery.isPending}
          error={
            credentialsQuery.data === undefined ? credentialsQuery.error : null
          }
          onRetry={retryRead}
          onErrorFocusLost={focusRegion}
          // A retry of a catalog that never loaded is not a first load: the
          // picker keeps saying it failed until the retry answers.
          catalogLoading={connectorsQuery.isPending && !catalogRead.unavailable}
          catalogFailure={
            catalogRead.unavailable
              ? {
                  message: catalogFailureMessage,
                  retry: retryCatalog,
                  retrying: catalogRead.retrying,
                  failureCount: catalogRead.failureCount,
                }
              : null
          }
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
      </SettingsSection>

      {/* Where consent goes is org security config — admin/owner only,
          like SSO; developers keep the credential table above. */}
      {ability.can('write', 'orgSettings') && (
        <OauthAppsCard
          organizationId={organizationId}
          connectors={connectorsQuery.data ?? []}
          catalogLoading={connectorsQuery.isLoading}
        />
      )}
    </SettingsPage>
  );
}
