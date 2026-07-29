'use client';

import { Alert } from '@tale/ui/alert';
import { SkeletonBox } from '@tale/ui/skeleton';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { useMemo } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import { mapConnectorError } from '../connector-errors';
import type { MaskedConnectorCredential } from '../hooks/backend';
import { useConnectors, useConnectorCredentials } from '../hooks/queries';
import { ConnectorSection } from './connector-section';

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
 * The connectors settings page: the connectors that ship with the platform
 * and the organization's credentials for each of them. Developer-gated,
 * matching its nav entry and the backend's write gate. The catalog comes from
 * a Convex action (it reads the shipped connector files); the credential list
 * is a reactive query, so writes propagate without manual refresh.
 *
 * A connector holds as many credentials as an organization needs — one per
 * workspace, per store, per bot — and invocations that name none fall back to
 * the connector's default, which is why every section makes the default (or
 * its absence) explicit.
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

  const credentialsByConnector = useMemo(() => {
    const grouped = new Map<string, MaskedConnectorCredential[]>();
    for (const credential of credentialsQuery.data ?? []) {
      const bucket = grouped.get(credential.connectorSlug);
      if (bucket) {
        bucket.push(credential);
      } else {
        grouped.set(credential.connectorSlug, [credential]);
      }
    }
    return grouped;
  }, [credentialsQuery.data]);

  if (!abilityLoading && ability.cannot('read', 'developerSettings')) {
    return <AccessDenied message={tAccessDenied('connectors')} />;
  }

  const connectors = connectorsQuery.data ?? [];
  const credentialCount = credentialsQuery.data?.length ?? 0;
  const countsReady =
    !connectorsQuery.isPending &&
    !connectorsQuery.isError &&
    !credentialsQuery.isPending &&
    !credentialsQuery.isError;

  return (
    <SettingsPage>
      <SettingsSection
        title={t('connectors.catalog.title')}
        description={t('connectors.catalog.description')}
      >
        {/* Counted, not guessed: the line waits for both listings rather than
            reading "0 credentials" while one is still in flight. */}
        {countsReady && (
          <Text as="p" variant="muted" className="text-sm">
            {t('connectors.catalog.summary', {
              connectors: connectors.length,
              credentials: credentialCount,
            })}
          </Text>
        )}
        {/* Without the credential list the sections below can only claim
            "no credentials yet", which would be a guess — say so instead. */}
        {credentialsQuery.isError && (
          <Alert
            variant="destructive"
            description={t('connectors.catalog.credentialsFailed', {
              error: mapConnectorError(credentialsQuery.error),
            })}
          />
        )}
      </SettingsSection>

      {connectorsQuery.isError ? (
        <Alert
          variant="destructive"
          description={t('connectors.catalog.listFailed', {
            error: mapConnectorError(connectorsQuery.error),
          })}
        />
      ) : abilityLoading || connectorsQuery.isPending ? (
        <ConnectorsLoading />
      ) : (
        connectors.map((connector) => (
          <ConnectorSection
            key={connector.slug}
            organizationId={organizationId}
            connector={connector}
            credentials={credentialsByConnector.get(connector.slug) ?? []}
          />
        ))
      )}
    </SettingsPage>
  );
}
