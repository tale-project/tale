'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Text } from '@tale/ui/text';
import { Link2 } from 'lucide-react';

import { VendorDetailDialog } from '@/app/features/settings/credentials/vendor-detail-dialog';
import { useT } from '@/lib/i18n/client';

import { goToAuthorization } from '../connector-oauth';
import {
  connectorCredentialAdapter,
  toConnectorVendor,
} from '../credential-adapter';
import type {
  ConnectorSummary,
  MaskedConnectorCredential,
} from '../hooks/backend';

/**
 * What a connector card opens: the catalog facts, the health of its grants, and
 * the organization's credentials for it.
 *
 * An OAuth connector is joined through consent, not filled into a form, so its
 * affordance LEAVES the page rather than opening a nested dialog. A connector
 * may declare both kinds; then both appear.
 */
export function ConnectorDetailDialog({
  organizationId,
  connector,
  credentials,
  open,
  onOpenChange,
}: {
  organizationId: string;
  connector: ConnectorSummary;
  credentials: readonly MaskedConnectorCredential[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('settings');
  const vendor = toConnectorVendor(connector);

  const offersConsent = connector.authMethods.includes('oauth2');
  const hasReauth = credentials.some(
    (credential) => credential.status === 'needs-reauth',
  );

  return (
    <VendorDetailDialog
      organizationId={organizationId}
      vendor={vendor}
      credentials={credentials}
      adapter={connectorCredentialAdapter}
      open={open}
      onOpenChange={onOpenChange}
      description={connector.description}
      facts={
        <div className="flex flex-wrap items-center gap-2">
          {connector.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
          <Text as="span" variant="muted" className="text-xs">
            {t('connectors.card.actionCount', { count: connector.actionCount })}
          </Text>
          {connector.endpointMode === 'per-credential' && (
            <Text as="span" variant="muted" className="text-xs">
              {t('connectors.card.perCredentialFact')}
            </Text>
          )}
        </div>
      }
      alerts={
        hasReauth ? (
          <Alert
            variant="warning"
            description={t('connectors.card.needsReauth')}
          />
        ) : undefined
      }
      emptyBody={
        <Text as="p" variant="muted" className="text-sm">
          {vendor.needsEndpoint ||
          connectorCredentialAdapter.formMethods(vendor).length > 0
            ? t('connectors.card.emptyBody')
            : t('connectors.card.emptyBodyOauth', {
                connector: connector.displayName,
              })}
        </Text>
      }
      extraActions={
        offersConsent ? (
          <Button
            icon={Link2}
            size="sm"
            variant="secondary"
            onClick={() => goToAuthorization(organizationId, connector.slug)}
          >
            {t('connectors.card.connect')}
          </Button>
        ) : undefined
      }
    />
  );
}
