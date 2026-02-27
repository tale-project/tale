'use client';

import { ExternalLink, Loader2 } from 'lucide-react';
import { useMemo } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import {
  type StatGridItem,
  StatGrid,
} from '@/app/components/ui/data-display/stat-grid';
import { ActionRow } from '@/app/components/ui/layout/action-row';
import { BorderedSection } from '@/app/components/ui/layout/bordered-section';
import { Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import { SENSITIVE_KEYS, maskValue } from '../../hooks/use-integration-manage';
import { TestResultFeedback } from './test-result-feedback';

interface IntegrationActiveViewProps {
  integration: Doc<'integrations'> & { iconUrl?: string | null };
  isSql: boolean;
  busy: boolean;
  isSubmitting: boolean;
  isTesting: boolean;
  isSavingOAuth2: boolean;
  hasOAuth2Config: boolean;
  testResult: { success: boolean; message: string } | null;
  secretBindings: string[];
  onTestConnection: () => void;
  onDisconnect: () => void;
  onReauthorize: () => void;
  onDismissTestResult: () => void;
}

export function IntegrationActiveView({
  integration,
  isSql,
  busy,
  isSubmitting,
  isTesting,
  isSavingOAuth2,
  hasOAuth2Config,
  testResult,
  secretBindings,
  onTestConnection,
  onDisconnect,
  onReauthorize,
  onDismissTestResult,
}: IntegrationActiveViewProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  const authItems = useMemo<StatGridItem[]>(
    () => [
      ...(isSql && integration.sqlConnectionConfig?.server
        ? [
            {
              label: t('integrations.manageDialog.server'),
              value: (
                <Text variant="code">
                  {maskValue(integration.sqlConnectionConfig.server)}
                </Text>
              ),
            },
          ]
        : []),
      ...(integration.authMethod === 'basic_auth' &&
      integration.basicAuth?.username
        ? [
            {
              label: t('integrations.manageDialog.username'),
              value: (
                <Text variant="code">
                  {maskValue(integration.basicAuth.username)}
                </Text>
              ),
            },
            {
              label: t('integrations.manageDialog.password'),
              value: <Text variant="code">{'\u00d7'.repeat(8)}</Text>,
            },
          ]
        : []),
      ...(integration.authMethod === 'api_key' && integration.apiKeyAuth
        ? [
            {
              label:
                secretBindings.find((b) => SENSITIVE_KEYS.has(b)) ?? 'apiKey',
              value: <Text variant="code">{'\u00d7'.repeat(8)}</Text>,
            },
          ]
        : []),
      ...(integration.authMethod === 'oauth2' && integration.oauth2Auth
        ? [
            {
              label: hasOAuth2Config
                ? t('integrations.manageDialog.connectedViaOAuth2')
                : 'accessToken',
              value: <Text variant="code">{'\u00d7'.repeat(8)}</Text>,
            },
          ]
        : []),
      ...(integration.connectionConfig?.domain
        ? [
            {
              label: 'domain',
              value: (
                <Text variant="code" truncate>
                  {maskValue(integration.connectionConfig.domain)}
                </Text>
              ),
            },
          ]
        : []),
      ...(integration.connectionConfig?.apiEndpoint
        ? [
            {
              label: 'apiEndpoint',
              value: (
                <Text variant="code" truncate>
                  {integration.connectionConfig.apiEndpoint}
                </Text>
              ),
            },
          ]
        : []),
    ],
    [integration, isSql, secretBindings, hasOAuth2Config, t],
  );

  return (
    <Stack gap={3}>
      <BorderedSection gap={2}>
        <Text variant="label">
          {t('integrations.manageDialog.authentication')}
        </Text>

        {authItems.length > 0 && (
          <StatGrid items={authItems} className="text-sm" />
        )}
      </BorderedSection>

      <Button
        variant="secondary"
        onClick={onTestConnection}
        disabled={busy}
        className="w-full"
      >
        {isTesting ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t('integrations.manageDialog.testingConnection')}
          </>
        ) : (
          t('integrations.manageDialog.testConnection')
        )}
      </Button>

      <ActionRow gap={2}>
        {hasOAuth2Config &&
          integration.authMethod === 'oauth2' &&
          integration.oauth2Config?.clientId && (
            <Button
              variant="secondary"
              onClick={onReauthorize}
              disabled={busy}
              className="flex-1"
            >
              {isSavingOAuth2 ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t('integrations.manageDialog.savingCredentials')}
                </>
              ) : (
                <>
                  <ExternalLink className="mr-2 size-4" />
                  {t('integrations.manageDialog.reauthorize')}
                </>
              )}
            </Button>
          )}
        <Button
          variant="secondary"
          onClick={onDisconnect}
          disabled={busy}
          className="flex-1"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {t('integrations.disconnecting')}
            </>
          ) : (
            t('integrations.disconnect')
          )}
        </Button>
      </ActionRow>

      {testResult && (
        <TestResultFeedback
          result={testResult}
          onDismiss={onDismissTestResult}
          closeLabel={tCommon('aria.close')}
        />
      )}
    </Stack>
  );
}
