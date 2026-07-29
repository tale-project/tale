'use client';

import { Alert } from '@tale/ui/alert';
import { Plug } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { CatalogToolbar } from '@/app/components/catalog/catalog-toolbar';
import { CatalogView } from '@/app/components/catalog/catalog-view';
import { useCatalogFacets } from '@/app/components/catalog/use-catalog-facets';
import { AccessDenied } from '@/app/components/layout/access-denied';
import { MultiSelect } from '@/app/components/ui/forms/multi-select';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { mapCredentialError } from '@/app/features/settings/credentials/map-credential-error';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useUrlState } from '@/app/hooks/use-url-state';
import { useT } from '@/lib/i18n/client';

import type {
  ConnectorSummary,
  MaskedConnectorCredential,
} from '../hooks/backend';
import { useConnectorCredentials, useConnectors } from '../hooks/queries';
import { ConnectorCard } from './connector-card';
import { ConnectorDetailDialog } from './connector-detail-dialog';

/** Tabs narrow by whether the organization holds any credential yet. */
const SCOPE_TABS = ['all', 'connected', 'available'] as const;
type ScopeTab = (typeof SCOPE_TABS)[number];

const isScopeTab = (value: string): value is ScopeTab =>
  (SCOPE_TABS as readonly string[]).includes(value);

/** Search covers what a reader would type: the vendor, what it does, its tags. */
const haystack = (connector: ConnectorSummary) => [
  connector.slug,
  connector.displayName,
  connector.description,
  ...connector.tags,
];

const tagsOf = (connector: ConnectorSummary) => connector.tags;

/**
 * The connectors settings page: every connector that ships with the platform as
 * a card, and the credentials for one of them behind whichever card is open.
 *
 * Developer-gated, matching its nav entry and the backend's write gate. The
 * catalog comes from a Convex action (it reads the shipped connector files); the
 * credential list is a reactive query, so writes propagate without a refresh.
 *
 * The open card lives in the URL (`?connector=<slug>`) rather than in component
 * state. OAuth consent leaves the page entirely and comes back, and a search
 * param is the only thing that survives that round trip — it also makes a
 * connector linkable from anywhere else in the app.
 */
export function ConnectorsSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const connectorsQuery = useConnectors(organizationId);
  const credentialsQuery = useConnectorCredentials(organizationId);

  const [tab, setTab] = useState<ScopeTab>('all');
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const { state, setState } = useUrlState({
    definitions: { connector: { default: null } },
  });

  const connectors = useMemo(
    () => connectorsQuery.data ?? [],
    [connectorsQuery.data],
  );

  const credentialsByConnector = useMemo(() => {
    const grouped = new Map<string, MaskedConnectorCredential[]>();
    for (const credential of credentialsQuery.data ?? []) {
      const bucket = grouped.get(credential.connectorSlug);
      if (bucket) bucket.push(credential);
      else grouped.set(credential.connectorSlug, [credential]);
    }
    return grouped;
  }, [credentialsQuery.data]);

  const matchesTab = useCallback(
    (connector: ConnectorSummary, active: ScopeTab) => {
      if (active === 'all') return true;
      const connected =
        (credentialsByConnector.get(connector.slug) ?? []).length > 0;
      return active === 'connected' ? connected : !connected;
    },
    [credentialsByConnector],
  );

  const { filtered, facetOptions } = useCatalogFacets({
    items: connectors,
    tab,
    matchesTab,
    facetValuesOf: tagsOf,
    selectedFacets: selectedTags,
    query,
    getHaystack: haystack,
  });

  if (!abilityLoading && ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccessDenied('connectors')} />;
  }

  const openConnector = connectors.find(
    (connector) => connector.slug === state.connector,
  );

  return (
    // The grid wants the full settings pane: capped at max-w-3xl it collapses
    // to two columns and sixteen connectors become a long scroll.
    <SettingsPage fullWidth>
      <CatalogToolbar
        tabs={{
          items: SCOPE_TABS.map((value) => ({
            value,
            label: t(`connectors.tabs.${value}`),
          })),
          value: tab,
          onValueChange: (next) => {
            if (isScopeTab(next)) setTab(next);
          },
        }}
        search={{
          value: query,
          onChange: (e) => setQuery(e.target.value),
          placeholder: t('connectors.searchPlaceholder'),
        }}
        filters={
          facetOptions.length > 0 ? (
            <div className="w-44">
              <MultiSelect
                options={facetOptions.map((tag) => ({
                  value: tag,
                  label: tag,
                }))}
                value={selectedTags}
                onValueChange={setSelectedTags}
                placeholder={t('connectors.tagFilterLabel')}
                aria-label={t('connectors.tagFilterLabel')}
              />
            </div>
          ) : undefined
        }
      />

      {/* Without the credential list the cards could only claim "no credentials
          yet", which would be a guess — say so instead. */}
      {credentialsQuery.isError && (
        <Alert
          variant="destructive"
          description={t('connectors.catalog.credentialsFailed', {
            error: mapCredentialError(credentialsQuery.error),
          })}
        />
      )}

      <CatalogView<ConnectorSummary>
        isPending={abilityLoading || connectorsQuery.isPending}
        isError={connectorsQuery.isError}
        errorMessage={t('connectors.catalog.listFailed', {
          error: mapCredentialError(connectorsQuery.error),
        })}
        items={filtered}
        hasItems={connectors.length > 0}
        itemKey={(connector) => connector.slug}
        renderItem={(connector) => (
          <ConnectorCard
            connector={connector}
            credentials={credentialsByConnector.get(connector.slug) ?? []}
            onOpen={() => setState('connector', connector.slug)}
          />
        )}
        empty={{
          icon: Plug,
          title: t('connectors.catalog.emptyTitle'),
          description: t('connectors.catalog.emptyBody'),
        }}
        skeletonCards={6}
      />

      {openConnector !== undefined && (
        <ConnectorDetailDialog
          organizationId={organizationId}
          connector={openConnector}
          credentials={credentialsByConnector.get(openConnector.slug) ?? []}
          open
          onOpenChange={(next) => {
            if (!next) setState('connector', null);
          }}
        />
      )}
    </SettingsPage>
  );
}
