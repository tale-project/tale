'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { useRefreshProviderCatalogs } from '../hooks/mutations';
import {
  useProviderCatalogs,
  useProviderCredentials,
  type ConnectorCatalog,
  type MaskedCredential,
} from '../hooks/queries';
import { mapProviderError } from '../provider-errors';
import { ConnectorSection } from './connector-section';

/** One line of the per-connector refresh report. */
interface RefreshOutcome {
  name: string;
  modelCount: number;
  error?: string;
}

function CatalogRefreshSection({
  organizationId,
  displayNames,
}: {
  organizationId: string;
  displayNames: ReadonlyMap<string, string>;
}) {
  const { t } = useT('settings');
  const refresh = useRefreshProviderCatalogs(organizationId);
  const [outcomes, setOutcomes] = useState<RefreshOutcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRefresh = async () => {
    setError(null);
    try {
      const results = await refresh.mutateAsync({ organizationId });
      setOutcomes(results);
    } catch (err) {
      console.error('providers: catalog refresh failed', err);
      setOutcomes(null);
      setError(
        t('providers.catalogs.refreshFailed', {
          error: mapProviderError(err),
        }),
      );
    }
  };

  return (
    <SettingsSection
      title={t('providers.catalogs.title')}
      description={t('providers.catalogs.description')}
      action={
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          onClick={() => void handleRefresh()}
          disabled={refresh.isPending}
        >
          {refresh.isPending
            ? t('providers.catalogs.refreshing')
            : t('providers.catalogs.refresh')}
        </Button>
      }
    >
      {error && <Alert variant="destructive" description={error} />}
      {outcomes !== null &&
        (outcomes.length === 0 ? (
          <Alert description={t('providers.catalogs.nothingToRefresh')} />
        ) : (
          <ul className="text-muted-foreground flex flex-col gap-1 text-sm">
            {outcomes.map((outcome) => (
              <li key={outcome.name}>
                {outcome.error !== undefined
                  ? t('providers.catalogs.resultError', {
                      name: displayNames.get(outcome.name) ?? outcome.name,
                      error: outcome.error,
                    })
                  : t('providers.catalogs.resultOk', {
                      name: displayNames.get(outcome.name) ?? outcome.name,
                      count: outcome.modelCount,
                    })}
              </li>
            ))}
          </ul>
        ))}
    </SettingsSection>
  );
}

/** Placeholder sections shown while the catalog action resolves. */
function ConnectorsLoading() {
  return (
    <Skeletonize loading>
      <SkeletonBox fullWidth>
        <div className="h-24 w-full rounded-lg" />
      </SkeletonBox>
      <SkeletonBox fullWidth>
        <div className="h-24 w-full rounded-lg" />
      </SkeletonBox>
    </Skeletonize>
  );
}

/**
 * The AI-providers settings page: shipped provider connectors (from the
 * system config, with their model catalogs) and the organization's
 * credentials per connector. Developer-gated, matching its nav entry and the
 * backend's write gate. Catalogs come from a Convex action and degrade per
 * connector; the credential list is a reactive query, so writes propagate
 * without manual refresh.
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

  const credentialsByProvider = useMemo(() => {
    const grouped = new Map<string, MaskedCredential[]>();
    for (const credential of credentialsQuery.data ?? []) {
      const bucket = grouped.get(credential.providerSlug);
      if (bucket) {
        bucket.push(credential);
      } else {
        grouped.set(credential.providerSlug, [credential]);
      }
    }
    return grouped;
  }, [credentialsQuery.data]);

  const displayNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const connector of catalogsQuery.data ?? []) {
      names.set(connector.name, connector.displayName);
    }
    return names;
  }, [catalogsQuery.data]);

  if (!abilityLoading && ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccessDenied('providers')} />;
  }

  const connectors: ConnectorCatalog[] = catalogsQuery.data ?? [];

  return (
    <SettingsPage>
      <CatalogRefreshSection
        organizationId={organizationId}
        displayNames={displayNames}
      />
      {catalogsQuery.isError ? (
        <Alert
          variant="destructive"
          description={t('providers.catalogs.listFailed', {
            error: mapProviderError(catalogsQuery.error),
          })}
        />
      ) : abilityLoading || catalogsQuery.isPending ? (
        <ConnectorsLoading />
      ) : (
        connectors.map((connector) => (
          <ConnectorSection
            key={connector.name}
            className="border-border border-t pt-8"
            organizationId={organizationId}
            connector={connector}
            credentials={credentialsByProvider.get(connector.name) ?? []}
          />
        ))
      )}
    </SettingsPage>
  );
}
