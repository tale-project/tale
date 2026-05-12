'use client';

import { Button } from '@tale/ui/button';
import { ExternalLink, Loader2 } from 'lucide-react';
import { useMemo } from 'react';

import { CollapsibleGuide } from '@/app/components/ui/data-display/collapsible-guide';
import {
  type StatGridItem,
  StatGrid,
} from '@/app/components/ui/data-display/stat-grid';
import { BorderedSection } from '@/app/components/ui/layout/bordered-section';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import type { Integration } from '../../hooks/use-integration-manage';
import { maskValue } from '../../hooks/use-integration-manage';
import { TestResultFeedback } from './test-result-feedback';

interface IntegrationActiveViewProps {
  integration: Integration;
  isSql: boolean;
  busy: boolean;
  isSavingOAuth2: boolean;
  isTesting: boolean;
  hasOAuth2Config: boolean;
  testResult: { success: boolean; message: string } | null;
  editableConfigFields: Array<{
    key: string;
    type: 'string' | 'number';
    defaultValue: string | number;
  }>;
  onReauthorize: () => void;
  onTestConnection: () => void;
  onDismissTestResult: () => void;
}

export function IntegrationActiveView({
  integration,
  isSql,
  busy,
  isSavingOAuth2,
  isTesting,
  hasOAuth2Config,
  testResult,
  editableConfigFields,
  onReauthorize,
  onTestConnection,
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
                  {maskValue(integration.sqlConnectionConfig.server ?? '')}
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
                  {maskValue(integration.basicAuth.username ?? '')}
                </Text>
              ),
            },
          ]
        : []),
      ...(integration.connectionConfig?.domain
        ? [
            {
              label: 'domain',
              value: (
                <Text variant="code" truncate>
                  {maskValue(integration.connectionConfig.domain ?? '')}
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
      ...editableConfigFields
        .filter((f) => f.key !== 'domain' && f.key !== 'apiEndpoint')
        .filter((f) => integration.connectionConfig?.[f.key] != null)
        .map((f) => ({
          label: f.key,
          value: (
            <Text variant="code" truncate>
              {String(integration.connectionConfig?.[f.key])}
            </Text>
          ),
        })),
    ],
    [integration, isSql, editableConfigFields, t],
  );

  return (
    <Stack gap={3}>
      <BorderedSection>
        <Text variant="label">
          {t('integrations.manageDialog.authentication')}
        </Text>

        {integration.authMethod === 'oauth2' &&
          integration.oauth2Auth &&
          hasOAuth2Config && (
            <Text variant="muted" className="text-sm">
              {t('integrations.manageDialog.connectedViaOAuth2')}
            </Text>
          )}

        {authItems.length > 0 && (
          <StatGrid items={authItems} className="text-sm" />
        )}
      </BorderedSection>

      {(() => {
        const showReauthorize =
          hasOAuth2Config &&
          integration.authMethod === 'oauth2' &&
          !!integration.oauth2Config?.clientId;
        if (!showReauthorize) {
          return (
            <HStack justify="end" align="center">
              <Button
                variant="secondary"
                onClick={onTestConnection}
                disabled={busy}
              >
                {isTesting
                  ? t('integrations.manageDialog.testingConnection')
                  : t('integrations.manageDialog.testConnection')}
              </Button>
            </HStack>
          );
        }
        return (
          <HStack gap={2} align="center" className="w-full">
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
            <Button
              variant="secondary"
              onClick={onTestConnection}
              disabled={busy}
              className="flex-1"
            >
              {isTesting
                ? t('integrations.manageDialog.testingConnection')
                : t('integrations.manageDialog.testConnection')}
            </Button>
          </HStack>
        );
      })()}

      {testResult && (
        <TestResultFeedback
          result={testResult}
          onDismiss={onDismissTestResult}
          closeLabel={tCommon('aria.close')}
        />
      )}

      {typeof integration.setupGuide === 'string' && (
        <CollapsibleGuide
          label={t('integrations.manageDialog.setupGuide')}
          content={integration.setupGuide}
        />
      )}
    </Stack>
  );
}
