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
          {/* `shrink-0` belongs on the BADGE, not the text beside it: the badge
              carries the fact and has no room to give, while a long label can
              truncate. The other way round squeezed "No catalog" to zero width. */}
          <span className="shrink-0">
            <Badge variant="outline">
              {catalogSourceLabel(t, provider.catalogSource)}
            </Badge>
          </span>
          {/* A count only where there is a catalog to count. What "no catalog"
              means for this provider needs a sentence, which belongs in the
              dialog — the meta row is one line. */}
          {provider.catalogSource !== 'none' && (
            <Text as="span" variant="muted" className="truncate text-xs">
              {t('providers.card.modelCount', {
                count: provider.models.length,
              })}
            </Text>
          )}
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
