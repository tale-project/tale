'use client';

import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';

import {
  CatalogCard,
  CatalogCardIcon,
} from '@/app/components/catalog/catalog-grid';
import { VendorIcon } from '@/app/features/settings/credentials/vendor-icon';
import { useT } from '@/lib/i18n/client';

import type { MaskedCredential, ProviderCatalog } from '../hooks/queries';
import { apiFormatLabel, catalogSourceLabel } from '../labels';

/** Host of a provider's base URL, for the wire-facts line. Absent for
 *  per-credential-endpoint providers, whose credentials carry their own URL. */
function baseUrlHost(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined) return undefined;
  try {
    return new URL(baseUrl).host;
  } catch (err) {
    console.warn('providers: unparsable provider baseUrl', baseUrl, err);
    return baseUrl;
  }
}

/**
 * One AI provider in the catalog grid.
 *
 * A provider has no description of its own, so the card's summary line is its
 * wire facts — which API dialect it speaks and which host it speaks to. That is
 * the thing an operator actually needs to recognise it by.
 *
 * A catalog that could not be fetched outranks the credential count on the
 * badge: a provider with two keys and no model list still cannot serve a
 * request.
 */
export function ProviderCard({
  provider,
  credentials,
  onOpen,
}: {
  provider: ProviderCatalog;
  credentials: readonly MaskedCredential[];
  onOpen: () => void;
}) {
  const { t } = useT('settings');

  const host = baseUrlHost(provider.baseUrl);
  const format = apiFormatLabel(t, provider.apiFormat);
  const facts =
    host !== undefined
      ? t('providers.card.facts', { format, host })
      : provider.endpointMode === 'per-credential'
        ? t('providers.card.factsPerCredential', { format })
        : format;

  const badge =
    provider.catalogError !== undefined ? (
      <Badge variant="orange">{t('providers.card.catalogFailed')}</Badge>
    ) : credentials.length > 0 ? (
      <Badge variant="slate">
        {t('providers.card.credentialCount', { count: credentials.length })}
      </Badge>
    ) : undefined;

  return (
    <CatalogCard
      media={
        <CatalogCardIcon>
          <VendorIcon iconUrl={provider.iconUrl} className="size-6" />
        </CatalogCardIcon>
      }
      title={provider.displayName}
      headingLevel={3}
      badge={badge}
      meta={
        <span className="flex min-w-0 items-center gap-2">
          <Badge variant="outline">
            {catalogSourceLabel(t, provider.catalogSource)}
          </Badge>
          <Text as="span" variant="muted" className="shrink-0 text-xs">
            {provider.catalogSource === 'none'
              ? t('providers.card.noCatalogHint')
              : t('providers.card.modelCount', {
                  count: provider.models.length,
                })}
          </Text>
        </span>
      }
      description={facts}
      onClick={onOpen}
      ariaLabel={t('providers.card.open', {
        provider: provider.displayName,
      })}
    />
  );
}
