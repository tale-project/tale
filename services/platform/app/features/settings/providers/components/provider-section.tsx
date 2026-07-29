'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { VendorIcon } from '@/app/features/settings/credentials/vendor-icon';
import { useT } from '@/lib/i18n/client';
import { SECRETS_ENV_PREFIX } from '@/lib/shared/schemas/providers';

import type { ProviderCatalog, MaskedCredential } from '../hooks/queries';
import {
  apiFormatLabel,
  catalogSourceLabel,
  isKnownAuthMethod,
} from '../labels';
import { CredentialCreateDialog } from './credential-create-dialog';
import { CredentialRow } from './credential-row';

interface ProviderSectionProps {
  organizationId: string;
  provider: ProviderCatalog;
  credentials: MaskedCredential[];
  className?: string;
}

/** Host of a provider's base URL, for the wire-facts line. Absent for
 * per-credential-endpoint providers, whose rows carry their own URL. */
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
 * One shipped provider: the wire facts (API format, endpoint host) in the
 * header, the catalog source + model count line (with the per-provider
 * degradation error when the live source is unreachable), and the
 * organization's credentials for this provider. A pair whose default was
 * deleted keeps working rows but no automatic pick — that state is surfaced,
 * never auto-fixed.
 */
export function ProviderSection({
  organizationId,
  provider,
  credentials,
  className,
}: ProviderSectionProps) {
  const { t } = useT('settings');
  const [createOpen, setCreateOpen] = useState(false);

  const hasNoDefault =
    credentials.length > 0 &&
    !credentials.some((credential) => credential.isDefault);

  // A provider may declare auth methods this page has no form for (e.g. a
  // vendor subscription key bound to a harness); adding is only offered when
  // at least one method the dialog can build is available.
  const offersKnownMethod = provider.authMethods.some(isKnownAuthMethod);

  const host = baseUrlHost(provider.baseUrl);
  const format = apiFormatLabel(t, provider.apiFormat);
  const facts =
    host !== undefined
      ? t('providers.card.facts', { format, host })
      : provider.endpointMode === 'per-credential'
        ? t('providers.card.factsPerCredential', { format })
        : format;

  return (
    <SettingsSection
      className={className}
      title={
        <span className="inline-flex items-center gap-2">
          <VendorIcon iconUrl={provider.iconUrl} className="size-5" />
          {provider.displayName}
        </span>
      }
      description={facts}
      action={
        <Button
          icon={Plus}
          size="sm"
          onClick={() => setCreateOpen(true)}
          disabled={!offersKnownMethod}
        >
          {t('providers.card.addCredential')}
        </Button>
      }
    >
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
      </div>

      {provider.catalogError !== undefined && (
        <Alert
          variant="warning"
          description={t('providers.card.catalogUnavailable', {
            error: provider.catalogError,
          })}
        />
      )}

      {hasNoDefault && (
        <Alert variant="warning" description={t('providers.card.noDefault')} />
      )}

      {credentials.length > 0 ? (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {credentials.map((credential) => (
            <CredentialRow
              key={credential.id}
              organizationId={organizationId}
              credential={credential}
              provider={provider}
            />
          ))}
        </ul>
      ) : (
        <div className="border-border rounded-lg border border-dashed px-4 py-6">
          <Stack gap={1}>
            <Text as="p" variant="label">
              {t('providers.card.emptyTitle')}
            </Text>
            <Text as="p" variant="muted" className="text-sm">
              {t('providers.card.emptyBody')}
            </Text>
            <Text as="p" variant="muted" className="text-sm">
              {t('providers.card.emptyEnvHint', {
                prefix: SECRETS_ENV_PREFIX,
              })}
            </Text>
          </Stack>
        </div>
      )}

      <CredentialCreateDialog
        organizationId={organizationId}
        provider={provider}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </SettingsSection>
  );
}
