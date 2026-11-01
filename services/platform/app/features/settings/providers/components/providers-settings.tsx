'use client';

import { Alert } from '@tale/ui/alert';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import { Stack } from '@tale/ui/layout';
import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { useRegisterSettingsSecondaryAction } from '@/app/features/settings/components/settings-secondary-action-context';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { CredentialTable } from '@/app/features/settings/credentials/credential-table';
import { credentialFailureDetail } from '@/app/features/settings/credentials/map-credential-error';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useListReadRecovery } from '@/app/hooks/use-list-read-recovery';
import { useUrlState } from '@/app/hooks/use-url-state';
import type { ProviderCatalogFailureCode } from '@/app/lib/backend/contract/lib';
import { readStateOf } from '@/app/lib/backend/read-state';
import { useT } from '@/lib/i18n/client';

import {
  providerCredentialAdapter,
  toProviderVendor,
} from '../credential-adapter';
import { useRefreshProviderCatalogs } from '../hooks/mutations';
import { useProviderCatalogs, useProviderCredentials } from '../hooks/queries';
import { HarnessStatusSection } from './harness-status-section';
import { catalogFailureText } from './provider-definition-form';

/** One line of the per-provider refresh report. */
interface RefreshOutcome {
  name: string;
  modelCount: number;
  error?: string;
  errorCode?: ProviderCatalogFailureCode;
}

/**
 * The AI-providers settings page: the organization's provider credentials as a
 * table, over the shipped catalog that "Add credential" opens onto.
 *
 * The catalog used to BE the page — twelve cards, most of them for providers
 * nobody had configured, with the two keys that actually served traffic hidden
 * one click inside one of them. The keys are the thing an operator manages, so
 * they are the rows; picking a provider is the first step of adding one.
 *
 * Developer-gated, matching its nav entry and the backend's write gate.
 * Catalogs come from a Convex action and degrade PER PROVIDER — one unreachable
 * vendor endpoint leaves the rest usable — while the credential list is a
 * reactive query, so writes propagate without a refresh.
 *
 * Harnesses are a section below rather than a fourth tab: a tab strip belonged
 * to the card grid's toolbar, and the table brings its own. Under a table of a
 * handful of rows the section is in plain sight, which is what moving it out of
 * the old twelve-card grid was for.
 *
 * A read that failed never reads as an empty one (#4831): a catalog that never
 * loaded is named above the table and in the Add credential picker, with Try
 * again, never as a deployment that ships no provider files; a credential list
 * that never loaded is the table's error state with its retry, never the
 * invitation to add a first credential, and rows a failed refresh left stay
 * under a notice that says so.
 */
export function ProvidersSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { t: tEmpty } = useT('emptyStates');
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const catalogsQuery = useProviderCatalogs(organizationId);
  const credentialsQuery = useProviderCredentials(organizationId);
  const refresh = useRefreshProviderCatalogs(organizationId);
  const catalogRead = readStateOf(catalogsQuery);
  const credentialsRead = readStateOf(credentialsQuery);
  const { refetch: refetchCatalogs } = catalogsQuery;
  const { refetch: refetchCredentials } = credentialsQuery;
  const retryCatalogs = () => void refetchCatalogs();
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
  if (catalogsQuery.isError) {
    catalogFailureRef.current = credentialFailureDetail(catalogsQuery.error);
  }
  const catalogFailureMessage = [
    t('providers.catalogs.listFailed'),
    catalogFailureRef.current,
  ]
    .filter(Boolean)
    .join(' ');

  const [outcomes, setOutcomes] = useState<RefreshOutcome[] | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [vendorFilter, setVendorFilter] = useState<string[]>([]);
  // A `?provider=` link — including the redirect from the retired
  // `providers/$providerName` route — narrows the table to that provider.
  const { state, setState } = useUrlState({
    definitions: { provider: { default: null } },
  });
  const urlProvider = state.provider;

  // Seeded FROM the url, not bound to it: the facet is multi-select and the
  // param holds one slug, so binding them would silently drop the operator's
  // second choice. Once they touch the facet the param steps aside.
  useEffect(() => {
    if (urlProvider !== null) setVendorFilter([urlProvider]);
  }, [urlProvider]);

  const vendors = useMemo(
    () => (catalogsQuery.data ?? []).map(toProviderVendor),
    [catalogsQuery.data],
  );

  const displayNames = useMemo(
    () => new Map(vendors.map((vendor) => [vendor.key, vendor.displayName])),
    [vendors],
  );

  const handleRefresh = async () => {
    setRefreshError(null);
    try {
      setOutcomes(await refresh.mutateAsync({ organizationId }));
    } catch (err) {
      console.error('providers: catalog refresh failed', err);
      setOutcomes(null);
      setRefreshError(t('providers.catalogs.refreshFailed'));
    }
  };

  // Refreshing the model catalogs is a page-level maintenance action, not
  // something the credentials table does — so it registers in the settings
  // header rather than competing with "Add credential" for the table's slot.
  useRegisterSettingsSecondaryAction([
    {
      label: t('providers.catalogs.refresh'),
      loadingLabel: t('providers.catalogs.refreshing'),
      onClick: () => void handleRefresh(),
      loading: refresh.isPending,
      disabled: refresh.isPending,
      variant: 'secondary',
    },
  ]);

  if (!abilityLoading && ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccessDenied('providers')} />;
  }

  return (
    <SettingsPage>
      <SettingsSection
        ref={regionRef}
        tabIndex={-1}
        className="outline-none"
        title={t('providers.credentialsSection.title')}
        description={t('providers.credentialsSection.description')}
      >
        <Stack gap={4}>
          {(catalogRead.unavailable || catalogRead.stale) && (
            <CatalogLoadError
              // Each failure is announced again; Try again keeps its node,
              // and the focus on it, while a retry runs.
              failureKey={catalogRead.failureCount}
              onFocusLost={focusRegion}
              message={catalogFailureMessage}
              onRetry={retryCatalogs}
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
          {refreshError !== null && (
            <Alert variant="destructive" description={refreshError} />
          )}
          {outcomes !== null &&
            (outcomes.length === 0 ? (
              <Alert description={t('providers.catalogs.nothingToRefresh')} />
            ) : (
              <Alert
                title={t('providers.catalogs.refreshed')}
                description={
                  <ul className="list-inside list-disc">
                    {outcomes.map((outcome) => (
                      <li key={outcome.name}>
                        {outcome.error !== undefined
                          ? t('providers.catalogs.resultError', {
                              name:
                                displayNames.get(outcome.name) ?? outcome.name,
                              error: catalogFailureText(
                                t,
                                outcome.error,
                                outcome.errorCode,
                              ),
                            })
                          : t('providers.catalogs.resultOk', {
                              name:
                                displayNames.get(outcome.name) ?? outcome.name,
                              count: outcome.modelCount,
                            })}
                      </li>
                    ))}
                  </ul>
                }
              />
            ))}

          <CredentialTable
            organizationId={organizationId}
            vendors={vendors}
            credentials={credentialsQuery.data ?? []}
            adapter={providerCredentialAdapter}
            isLoading={abilityLoading || credentialsQuery.isPending}
            error={
              credentialsQuery.data === undefined
                ? credentialsQuery.error
                : null
            }
            onRetry={retryRead}
            onErrorFocusLost={focusRegion}
            // A retry of a catalog that never loaded is not a first load: the
            // picker keeps saying it failed until the retry answers.
            catalogLoading={catalogsQuery.isPending && !catalogRead.unavailable}
            catalogFailure={
              catalogRead.unavailable
                ? {
                    message: catalogFailureMessage,
                    retry: retryCatalogs,
                    retrying: catalogRead.retrying,
                    failureCount: catalogRead.failureCount,
                  }
                : null
            }
            labels={{
              vendorColumn: t('providers.vendorColumn'),
              vendorFilter: t('providers.vendorFilterLabel'),
              catalogSearch: t('providers.searchPlaceholder'),
              catalogEmpty: t('providers.catalogs.emptyBody'),
              empty: {
                icon: Sparkles,
                title: tEmpty('providers.title'),
                description: tEmpty('providers.description'),
              },
            }}
            vendorFilter={vendorFilter}
            onVendorFilterChange={(next) => {
              setVendorFilter(next);
              if (urlProvider !== null) setState('provider', null);
            }}
          />
        </Stack>
      </SettingsSection>

      <SettingsSection
        title={t('providers.harnesses.title')}
        description={t('providers.harnesses.description')}
      >
        <HarnessStatusSection
          organizationId={organizationId}
          displayNames={displayNames}
        />
      </SettingsSection>
    </SettingsPage>
  );
}
