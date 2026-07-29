'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link2, Plus } from 'lucide-react';
import { useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { VendorIcon } from '@/app/features/settings/credentials/vendor-icon';
import { useT } from '@/lib/i18n/client';

import { goToAuthorization } from '../connector-oauth';
import type {
  ConnectorSummary,
  MaskedConnectorCredential,
} from '../hooks/backend';
import { CredentialCreateDialog } from './credential-create-dialog';
import { CredentialRow } from './credential-row';

interface ConnectorSectionProps {
  organizationId: string;
  connector: ConnectorSummary;
  credentials: MaskedConnectorCredential[];
  className?: string;
}

/**
 * One shipped connector: its icon and description in the header, the catalog
 * facts (tags, how many actions it exposes, whether each credential names its
 * own instance) below, and the organization's credentials for it.
 *
 * Two states are surfaced rather than repaired. A connector whose credentials
 * lost their default keeps working rows but no automatic pick, so an
 * invocation that names none has nothing to fall back to. A grant that stopped
 * refreshing is called out here as well as on its row, because the fix —
 * re-running consent — starts with the person reading this section.
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
  const hasReauth = credentials.some(
    (credential) => credential.status === 'needs-reauth',
  );
  // An OAuth connector is joined through consent, not filled into a form, so
  // its affordance leaves the page instead of opening a dialog. A connector
  // may declare both kinds; then both buttons appear.
  const offersConsent = connector.authMethods.includes('oauth2');
  const formMethods = connector.authMethods.filter(
    (method) => method !== 'oauth2' && method !== 'platform',
  );

  return (
    <SettingsSection
      className={className}
      title={
        <span className="flex items-center gap-2">
          <VendorIcon iconUrl={connector.iconUrl} />
          {connector.displayName}
        </span>
      }
      description={connector.description}
      action={
        <div className="flex flex-wrap items-center gap-2">
          {offersConsent && (
            <Button
              icon={Link2}
              size="sm"
              onClick={() => goToAuthorization(organizationId, connector.slug)}
            >
              {t('connectors.card.connect')}
            </Button>
          )}
          {formMethods.length > 0 && (
            <Button
              icon={Plus}
              size="sm"
              variant={offersConsent ? 'secondary' : 'primary'}
              onClick={() => setCreateOpen(true)}
            >
              {t('connectors.card.addCredential')}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {connector.tags.map((tag) => (
          <Badge key={tag} variant="outline">
            {tag}
          </Badge>
        ))}
        <Text as="span" variant="muted" className="text-xs">
          {t('connectors.card.actionCount', {
            count: connector.actionCount,
          })}
        </Text>
        {connector.endpointMode === 'per-credential' && (
          <Text as="span" variant="muted" className="text-xs">
            {t('connectors.card.perCredentialFact')}
          </Text>
        )}
      </div>

      {hasReauth && (
        <Alert
          variant="warning"
          description={t('connectors.card.needsReauth')}
        />
      )}

      {hasNoDefault && (
        <Alert variant="warning" description={t('connectors.card.noDefault')} />
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
              {t('connectors.card.emptyTitle')}
            </Text>
            <Text as="p" variant="muted" className="text-sm">
              {formMethods.length === 0
                ? t('connectors.card.emptyBodyOauth', {
                    connector: connector.displayName,
                  })
                : t('connectors.card.emptyBody')}
            </Text>
          </Stack>
        </div>
      )}

      <CredentialCreateDialog
        organizationId={organizationId}
        connector={connector}
        methods={formMethods}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </SettingsSection>
  );
}
