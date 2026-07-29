'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';

import { VendorDetailDialog } from '@/app/features/settings/credentials/vendor-detail-dialog';
import { useT } from '@/lib/i18n/client';
import { SECRETS_ENV_PREFIX } from '@/lib/shared/schemas/providers';

import {
  providerCredentialAdapter,
  toProviderVendor,
} from '../credential-adapter';
import type { MaskedCredential, ProviderCatalog } from '../hooks/queries';
import { apiFormatLabel, catalogSourceLabel } from '../labels';

/**
 * What a provider card opens: its wire facts, the state of its model catalog,
 * and the organization's credentials for it.
 *
 * A catalog that could not be served degrades per provider rather than blanking
 * the page — the credentials still work, the model list is just stale — so it is
 * reported here as a warning next to the facts it affects.
 */
export function ProviderDetailDialog({
  organizationId,
  provider,
  credentials,
  open,
  onOpenChange,
}: {
  organizationId: string;
  provider: ProviderCatalog;
  credentials: readonly MaskedCredential[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('settings');
  const vendor = toProviderVendor(provider);

  return (
    <VendorDetailDialog
      organizationId={organizationId}
      vendor={vendor}
      credentials={credentials}
      adapter={providerCredentialAdapter}
      open={open}
      onOpenChange={onOpenChange}
      description={apiFormatLabel(t, provider.apiFormat)}
      facts={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {catalogSourceLabel(t, provider.catalogSource)}
          </Badge>
          <Text as="span" variant="muted" className="text-xs">
            {provider.catalogSource === 'none'
              ? t('providers.card.noCatalogHint')
              : t('providers.card.modelCount', {
                  count: provider.models.length,
                })}
          </Text>
          {provider.baseUrl !== undefined && (
            <span className="text-muted-foreground truncate font-mono text-xs">
              {provider.baseUrl}
            </span>
          )}
        </div>
      }
      alerts={
        provider.catalogError !== undefined ? (
          <Alert
            variant="warning"
            description={t('providers.card.catalogUnavailable', {
              error: provider.catalogError,
            })}
          />
        ) : undefined
      }
      emptyBody={
        <>
          <Text as="p" variant="muted" className="text-sm">
            {t('providers.card.emptyBody')}
          </Text>
          <Text as="p" variant="muted" className="text-sm">
            {t('providers.card.emptyEnvHint', { prefix: SECRETS_ENV_PREFIX })}
          </Text>
        </>
      }
    />
  );
}
