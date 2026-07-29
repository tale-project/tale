'use client';

import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';

import {
  CatalogCard,
  CatalogCardIcon,
} from '@/app/components/catalog/catalog-grid';
import { CatalogLabels } from '@/app/components/catalog/catalog-labels';
import { VendorIcon } from '@/app/features/settings/credentials/vendor-icon';
import { useT } from '@/lib/i18n/client';

import type {
  ConnectorSummary,
  MaskedConnectorCredential,
} from '../hooks/backend';

/**
 * One connector in the catalog grid.
 *
 * A card carries only what a reader scans across sixteen of them: the vendor,
 * what it does, how many credentials they hold for it, and whether any of them
 * needs attention. Everything actionable is one click away in the detail
 * dialog — which is what lets the grid stay a scannable grid.
 *
 * The badge is deliberately the health state when there is one and the count
 * otherwise: "2 credentials" is reassuring but useless next to a grant that
 * stopped refreshing.
 */
export function ConnectorCard({
  connector,
  credentials,
  onOpen,
}: {
  connector: ConnectorSummary;
  credentials: readonly MaskedConnectorCredential[];
  onOpen: () => void;
}) {
  const { t } = useT('settings');

  const needsReauth = credentials.some(
    (credential) => credential.status === 'needs-reauth',
  );

  const badge = needsReauth ? (
    <Badge variant="orange">{t('connectors.credential.needsReauth')}</Badge>
  ) : credentials.length > 0 ? (
    <Badge variant="slate">
      {t('connectors.card.credentialCount', { count: credentials.length })}
    </Badge>
  ) : undefined;

  return (
    <CatalogCard
      media={
        <CatalogCardIcon>
          <VendorIcon iconUrl={connector.iconUrl} className="size-6" />
        </CatalogCardIcon>
      }
      title={connector.displayName}
      headingLevel={3}
      badge={badge}
      meta={
        <span className="flex min-w-0 items-center gap-2">
          <CatalogLabels labels={connector.tags} tone="quiet" />
          <Text as="span" variant="muted" className="shrink-0 text-xs">
            {t('connectors.card.actionCount', {
              count: connector.actionCount,
            })}
          </Text>
        </span>
      }
      description={connector.description}
      onClick={onOpen}
      ariaLabel={t('connectors.card.open', {
        connector: connector.displayName,
      })}
    />
  );
}
