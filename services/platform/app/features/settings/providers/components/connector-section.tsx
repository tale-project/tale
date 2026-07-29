'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Plus } from 'lucide-react';
import { useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { ConnectorIcon } from '@/app/features/settings/connectors/components/connector-icon';
import { useT } from '@/lib/i18n/client';
import { SECRETS_ENV_PREFIX } from '@/lib/shared/schemas/providers';

import type { ConnectorCatalog, MaskedCredential } from '../hooks/queries';
import {
  apiFormatLabel,
  catalogSourceLabel,
  isKnownAuthMethod,
} from '../labels';
import { CredentialCreateDialog } from './credential-create-dialog';
import { CredentialRow } from './credential-row';

interface ConnectorSectionProps {
  organizationId: string;
  connector: ConnectorCatalog;
  credentials: MaskedCredential[];
  className?: string;
}

/** Host of a connector's base URL, for the wire-facts line. Absent for
 * per-credential-endpoint connectors, whose rows carry their own URL. */
function baseUrlHost(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined) return undefined;
  try {
    return new URL(baseUrl).host;
  } catch (err) {
    console.warn('providers: unparsable connector baseUrl', baseUrl, err);
    return baseUrl;
  }
}

/**
 * One shipped connector: the wire facts (API format, endpoint host) in the
 * header, the catalog source + model count line (with the per-connector
 * degradation error when the live source is unreachable), and the
 * organization's credentials for this provider. A pair whose default was
 * deleted keeps working rows but no automatic pick — that state is surfaced,
 * never auto-fixed.
 */
export function ConnectorSection({
  organizationId,
  connector,
  credentials,
  className,
}: ConnectorSectionProps) {
  const { t } = useT('settings');
  const [createOpen, setCreateOpen] = useState(false);

  const hasNoDefault =
    credentials.length > 0 &&
    !credentials.some((credential) => credential.isDefault);

  // A connector may declare auth methods this page has no form for (e.g. a
  // vendor subscription key bound to a harness); adding is only offered when
  // at least one method the dialog can build is available.
  const offersKnownMethod = connector.authMethods.some(isKnownAuthMethod);

  const host = baseUrlHost(connector.baseUrl);
  const format = apiFormatLabel(t, connector.apiFormat);
  const facts =
    host !== undefined
      ? t('providers.connector.facts', { format, host })
      : connector.endpointMode === 'per-credential'
        ? t('providers.connector.factsPerCredential', { format })
        : format;

  return (
    <SettingsSection
      className={className}
      title={
        <span className="inline-flex items-center gap-2">
          <ConnectorIcon iconUrl={connector.iconUrl} className="size-5" />
          {connector.displayName}
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
          {t('providers.connector.addCredential')}
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          {catalogSourceLabel(t, connector.catalogSource)}
        </Badge>
        <Text as="span" variant="muted" className="text-xs">
          {connector.catalogSource === 'none'
            ? t('providers.connector.noCatalogHint')
            : t('providers.connector.modelCount', {
                count: connector.models.length,
              })}
        </Text>
      </div>

      {connector.catalogError !== undefined && (
        <Alert
          variant="warning"
          description={t('providers.connector.catalogUnavailable', {
            error: connector.catalogError,
          })}
        />
      )}

      {hasNoDefault && (
        <Alert
          variant="warning"
          description={t('providers.connector.noDefault')}
        />
      )}

      {credentials.length > 0 ? (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {credentials.map((credential) => (
            <CredentialRow
              key={credential.id}
              organizationId={organizationId}
              credential={credential}
              connector={connector}
            />
          ))}
        </ul>
      ) : (
        <div className="border-border rounded-lg border border-dashed px-4 py-6">
          <Stack gap={1}>
            <Text as="p" variant="label">
              {t('providers.connector.emptyTitle')}
            </Text>
            <Text as="p" variant="muted" className="text-sm">
              {t('providers.connector.emptyBody')}
            </Text>
            <Text as="p" variant="muted" className="text-sm">
              {t('providers.connector.emptyEnvHint', {
                prefix: SECRETS_ENV_PREFIX,
              })}
            </Text>
          </Stack>
        </div>
      )}

      <CredentialCreateDialog
        organizationId={organizationId}
        connector={connector}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </SettingsSection>
  );
}
