'use client';

import { BorderedSection } from '@tale/ui/bordered-section';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { type StatGridItem, StatGrid } from '@tale/ui/stat-grid';
import { Text } from '@tale/ui/text';
import { ExternalLink, Loader2, PlugZap, Unplug } from 'lucide-react';
import { useMemo } from 'react';

import { CollapsibleGuide } from '@/app/components/ui/data-display/collapsible-guide';
import { useT } from '@/lib/i18n/client';

import type { Integration } from '../../hooks/use-integration-manage';
import { TestResultFeedback } from './test-result-feedback';

/** Connected-summary config keys whose values are long identity strings
 *  (emails, hosts, URLs) — shown full-width so the 2-column grid doesn't clip
 *  or orphan-wrap them. Short values (ports, flags) keep the paired layout. */
const WIDE_CONFIG_KEY =
  /host|url|uri|endpoint|address|domain|server|email|dsn/i;

interface IntegrationActiveViewProps {
  integration: Integration;
  isSql: boolean;
  busy: boolean;
  isSavingOAuth2: boolean;
  isTesting: boolean;
  isDisconnecting: boolean;
  hasOAuth2Config: boolean;
  testResult: { success: boolean; message: string } | null;
  editableConfigFields: Array<{
    key: string;
    type: 'string' | 'number';
    defaultValue: string | number;
  }>;
  onReauthorize: () => void;
  onTestConnection: () => void;
  onDisconnect: () => void;
  onDismissTestResult: () => void;
}

export function IntegrationActiveView({
  integration,
  isSql,
  busy,
  isSavingOAuth2,
  isTesting,
  isDisconnecting,
  hasOAuth2Config,
  testResult,
  editableConfigFields,
  onReauthorize,
  onTestConnection,
  onDisconnect,
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
              colSpan: 2 as const,
              value: (
                <Text variant="code">
                  {integration.sqlConnectionConfig.server ?? ''}
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
              colSpan: 2 as const,
              value: (
                <Text variant="code">
                  {integration.basicAuth.username ?? ''}
                </Text>
              ),
            },
          ]
        : []),
      ...(integration.connectionConfig?.domain
        ? [
            {
              label: 'domain',
              colSpan: 2 as const,
              value: (
                <Text variant="code">
                  {integration.connectionConfig.domain ?? ''}
                </Text>
              ),
            },
          ]
        : []),
      ...(integration.connectionConfig?.apiEndpoint
        ? [
            {
              label: 'apiEndpoint',
              colSpan: 2 as const,
              value: (
                <Text variant="code">
                  {integration.connectionConfig.apiEndpoint}
                </Text>
              ),
            },
          ]
        : []),
      ...editableConfigFields
        .filter((f) => f.key !== 'domain' && f.key !== 'apiEndpoint')
        .filter((f) => integration.connectionConfig?.[f.key] != null)
        .map(
          (f): StatGridItem => ({
            label: f.key,
            // Emails/hosts/URLs get their own full-width row so the narrow
            // 2-col grid doesn't clip or orphan-wrap them; short values pair up.
            colSpan: WIDE_CONFIG_KEY.test(f.key) ? 2 : 1,
            value: (
              <Text variant="code">
                {String(integration.connectionConfig?.[f.key])}
              </Text>
            ),
          }),
        ),
    ],
    [integration, isSql, editableConfigFields, t],
  );

  return (
    <Stack gap={3}>
      {typeof integration.setupGuide === 'string' && (
        <CollapsibleGuide
          label={t('integrations.manageDialog.setupGuide')}
          content={integration.setupGuide}
        />
      )}

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
            <HStack justify="end" align="center" gap={2}>
              <Button
                variant="secondary"
                onClick={onDisconnect}
                disabled={busy}
              >
                {isDisconnecting ? (
                  <>
                    <Loader2 className="mr-2 size-3.5 animate-spin" />
                    {t('integrations.disconnecting')}
                  </>
                ) : (
                  <>
                    <Unplug className="mr-2 size-3.5" />
                    {t('integrations.disconnect')}
                  </>
                )}
              </Button>
              <Button
                variant="secondary"
                onClick={onTestConnection}
                disabled={busy}
              >
                {isTesting ? (
                  <>
                    <Loader2 className="mr-2 size-3.5 animate-spin" />
                    {t('integrations.manageDialog.testingConnection')}
                  </>
                ) : (
                  <>
                    <PlugZap className="mr-2 size-3.5" />
                    {t('integrations.manageDialog.testConnection')}
                  </>
                )}
              </Button>
            </HStack>
          );
        }
        return (
          <HStack gap={2} align="center" className="w-full">
            <Button
              variant="secondary"
              onClick={onDisconnect}
              disabled={busy}
              className="flex-1"
            >
              {isDisconnecting ? (
                <>
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  {t('integrations.disconnecting')}
                </>
              ) : (
                <>
                  <Unplug className="mr-2 size-3.5" />
                  {t('integrations.disconnect')}
                </>
              )}
            </Button>
            <Button
              variant="secondary"
              onClick={onReauthorize}
              disabled={busy}
              className="flex-1"
            >
              {isSavingOAuth2 ? (
                <>
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  {t('integrations.manageDialog.savingCredentials')}
                </>
              ) : (
                <>
                  <ExternalLink className="mr-2 size-3.5" />
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
              {isTesting ? (
                <>
                  <Loader2 className="mr-2 size-3.5 animate-spin" />
                  {t('integrations.manageDialog.testingConnection')}
                </>
              ) : (
                <>
                  <PlugZap className="mr-2 size-3.5" />
                  {t('integrations.manageDialog.testConnection')}
                </>
              )}
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
    </Stack>
  );
}
