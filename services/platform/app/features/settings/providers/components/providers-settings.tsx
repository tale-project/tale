'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { CatalogToolbar } from '@/app/components/catalog/catalog-toolbar';
import { CatalogView } from '@/app/components/catalog/catalog-view';
import { useCatalogFacets } from '@/app/components/catalog/use-catalog-facets';
import { AccessDenied } from '@/app/components/layout/access-denied';
import {
  FilterPanel,
  isFilterAffordanceDisabled,
  type FilterConfig,
} from '@/app/components/ui/filters/filter-panel';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useUrlState } from '@/app/hooks/use-url-state';
import { useT } from '@/lib/i18n/client';

import { useRefreshProviderCatalogs } from '../hooks/mutations';
import {
  useProviderCatalogs,
  useProviderCredentials,
  type MaskedCredential,
  type ProviderCatalog,
} from '../hooks/queries';
import { apiFormatLabel } from '../labels';
import { HarnessStatusSection } from './harness-status-section';
import { ProviderCard } from './provider-card';
import { ProviderDetailDialog } from './provider-detail-dialog';

/** Tabs narrow by whether the organization has credentials for the provider. */
const SCOPE_TABS = ['all', 'configured', 'unconfigured'] as const;
type ScopeTab = (typeof SCOPE_TABS)[number];

/**
 * The harness status report is a fourth tab rather than a section under the
 * grid, where it was easy to miss entirely. It is NOT a scope — it selects
 * different content — so it never reaches `matchesTab`.
 */
const HARNESS_TAB = 'harnesses';
const PROVIDER_TABS = [...SCOPE_TABS, HARNESS_TAB] as const;
type ProviderTab = (typeof PROVIDER_TABS)[number];

const isProviderTab = (value: string): value is ProviderTab =>
  (PROVIDER_TABS as readonly string[]).includes(value);

/** Search covers the provider AND the models it serves — an operator hunting
 *  for who can serve a given model id should find it by typing that id. */
const haystack = (provider: ProviderCatalog) => [
  provider.name,
  provider.displayName,
  provider.baseUrl,
  ...provider.models.map((model) => model.id),
];

/** The facet is the wire dialect: it decides which SDK path a call takes. */
const apiFormatOf = (provider: ProviderCatalog) => [provider.apiFormat];

/** One line of the per-provider refresh report. */
interface RefreshOutcome {
  name: string;
  modelCount: number;
  error?: string;
}

/**
 * The AI-providers settings page: every shipped provider as a card, with the
 * organization's credentials for one of them behind whichever card is open.
 *
 * Developer-gated, matching its nav entry and the backend's write gate.
 * Catalogs come from a Convex action and degrade PER PROVIDER — one unreachable
 * vendor endpoint leaves the rest of the grid intact — while the credential list
 * is a reactive query, so writes propagate without a refresh.
 *
 * Harnesses get their own tab. They are not credentials and nothing here
 * manages them, so they stay a read-only report rather than becoming cards
 * that open onto nothing — but a tab makes them findable, which a section
 * stranded under a twelve-card grid was not.
 */
export function ProvidersSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const catalogsQuery = useProviderCatalogs(organizationId);
  const credentialsQuery = useProviderCredentials(organizationId);
  const refresh = useRefreshProviderCatalogs(organizationId);

  const [tab, setTab] = useState<ProviderTab>('all');
  const [query, setQuery] = useState('');
  const [selectedFormats, setSelectedFormats] = useState<string[]>([]);
  const [outcomes, setOutcomes] = useState<RefreshOutcome[] | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const { state, setState } = useUrlState({
    definitions: { provider: { default: null } },
  });

  const providers = useMemo(
    () => catalogsQuery.data ?? [],
    [catalogsQuery.data],
  );

  const credentialsByProvider = useMemo(() => {
    const grouped = new Map<string, MaskedCredential[]>();
    for (const credential of credentialsQuery.data ?? []) {
      const bucket = grouped.get(credential.providerSlug);
      if (bucket) bucket.push(credential);
      else grouped.set(credential.providerSlug, [credential]);
    }
    return grouped;
  }, [credentialsQuery.data]);

  const displayNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const provider of providers) {
      names.set(provider.name, provider.displayName);
    }
    return names;
  }, [providers]);

  const matchesTab = useCallback(
    (provider: ProviderCatalog, active: ScopeTab) => {
      if (active === 'all') return true;
      const configured =
        (credentialsByProvider.get(provider.name) ?? []).length > 0;
      return active === 'configured' ? configured : !configured;
    },
    [credentialsByProvider],
  );

  const { filtered, facetOptions } = useCatalogFacets({
    items: providers,
    // The harness tab shows no grid, so it narrows nothing.
    tab: tab === HARNESS_TAB ? 'all' : tab,
    matchesTab,
    facetValuesOf: apiFormatOf,
    selectedFacets: selectedFormats,
    query,
    getHaystack: haystack,
  });

  const handleRefresh = async () => {
    setRefreshError(null);
    try {
      setOutcomes(await refresh.mutateAsync({ organizationId }));
    } catch (err) {
      console.error('providers: catalog refresh failed', err);
      setOutcomes(null);
      setRefreshError(
        t('providers.catalogs.refreshFailed', {
          error: mapCredentialError(err),
        }),
      );
    }
  };

  if (!abilityLoading && ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccessDenied('providers')} />;
  }

  const openProvider = providers.find(
    (provider) => provider.name === state.provider,
  );

  const showHarnesses = tab === HARNESS_TAB;

  // One dialect across the whole catalog is not a choice worth a control, so
  // the filter drops out entirely rather than offering a single option.
  const formatFilters: FilterConfig[] =
    facetOptions.length > 1
      ? [
          {
            key: 'apiFormat',
            title: t('providers.formatFilterLabel'),
            options: facetOptions.map((format) => ({
              value: format,
              label: apiFormatLabel(t, format),
            })),
            selectedValues: selectedFormats,
            onChange: setSelectedFormats,
            multiSelect: true,
          },
        ]
      : [];

  return (
    <SettingsPage>
      <CatalogToolbar
        tabs={{
          items: [
            ...SCOPE_TABS.map((value) => ({
              value,
              label: t(`providers.tabs.${value}`),
            })),
            // The section heading is now the tab label — one string, not two
            // that can drift apart.
            { value: HARNESS_TAB, label: t('providers.harnesses.title') },
          ],
          value: tab,
          onValueChange: (next) => {
            if (isProviderTab(next)) setTab(next);
          },
        }}
        // The harness report is not a grid: a search box and a facet button
        // over it would narrow nothing.
        {...(showHarnesses
          ? {}
          : {
              search: {
                value: query,
                onChange: (e) => setQuery(e.target.value),
                placeholder: t('providers.searchPlaceholder'),
              },
              filters: (
                <FilterPanel
                  filters={formatFilters}
                  onClearAll={() => {
                    setQuery('');
                    setSelectedFormats([]);
                  }}
                  isLoading={catalogsQuery.isPending}
                  disabled={isFilterAffordanceDisabled({
                    isLoading: catalogsQuery.isPending,
                    itemCount: providers.length,
                    hasActiveFilters:
                      query.length > 0 || selectedFormats.length > 0,
                    filters: formatFilters,
                  })}
                />
              ),
              action: (
                <Button
                  variant="secondary"
                  icon={RefreshCw}
                  onClick={() => void handleRefresh()}
                  disabled={refresh.isPending}
                >
                  {refresh.isPending
                    ? t('providers.catalogs.refreshing')
                    : t('providers.catalogs.refresh')}
                </Button>
              ),
            })}
      />

      {showHarnesses ? (
        <HarnessStatusSection
          organizationId={organizationId}
          displayNames={displayNames}
        />
      ) : (
        <>
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
                              error: outcome.error,
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

          <CatalogView<ProviderCatalog>
            isPending={abilityLoading || catalogsQuery.isPending}
            isError={catalogsQuery.isError}
            errorMessage={t('providers.catalogs.listFailed', {
              error: mapCredentialError(catalogsQuery.error),
            })}
            items={filtered}
            hasItems={providers.length > 0}
            itemKey={(provider) => provider.name}
            renderItem={(provider) => (
              <ProviderCard
                provider={provider}
                credentials={credentialsByProvider.get(provider.name) ?? []}
                onOpen={() => setState('provider', provider.name)}
              />
            )}
            empty={{
              icon: Sparkles,
              title: t('providers.catalogs.emptyTitle'),
              description: t('providers.catalogs.emptyBody'),
            }}
            skeletonCards={6}
          />
        </>
      )}

      {/* Outside the tab switch: a `?provider=` link must open its card
          whichever tab the page happens to be on. */}
      {openProvider !== undefined && (
        <ProviderDetailDialog
          organizationId={organizationId}
          provider={openProvider}
          credentials={credentialsByProvider.get(openProvider.name) ?? []}
          open
          onOpenChange={(next) => {
            if (!next) setState('provider', null);
          }}
        />
      )}
    </SettingsPage>
  );
}
