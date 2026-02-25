'use client';

import { ExternalLink, Loader2 } from 'lucide-react';

import type { Doc } from '@/convex/_generated/dataModel';

import { ActionRow } from '@/app/components/ui/layout/action-row';
import { BorderedSection } from '@/app/components/ui/layout/bordered-section';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
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

  return (
    <Stack gap={3}>
      <BorderedSection gap={2}>
        <Text variant="label">
          {t('integrations.manageDialog.authentication')}
        </Text>

        {isSql && integration.sqlConnectionConfig?.server && (
          <HStack
            gap={2}
            className="text-muted-foreground items-center text-sm"
          >
            <Text as="span" variant="body-sm" className="w-20 shrink-0">
              {t('integrations.manageDialog.server')}
            </Text>
            <Text as="span" variant="code">
              {maskValue(integration.sqlConnectionConfig.server)}
            </Text>
          </HStack>
        )}

        {integration.authMethod === 'basic_auth' &&
          integration.basicAuth?.username && (
            <>
              <HStack
                gap={2}
                className="text-muted-foreground items-center text-sm"
              >
                <Text as="span" variant="body-sm" className="w-20 shrink-0">
                  {t('integrations.manageDialog.username')}
                </Text>
                <Text as="span" variant="code">
                  {maskValue(integration.basicAuth.username)}
                </Text>
              </HStack>
              <HStack
                gap={2}
                className="text-muted-foreground items-center text-sm"
              >
                <Text as="span" variant="body-sm" className="w-20 shrink-0">
                  {t('integrations.manageDialog.password')}
                </Text>
                <Text as="span" variant="code">
                  {'\u00d7'.repeat(8)}
                </Text>
              </HStack>
            </>
          )}

        {integration.authMethod === 'api_key' && integration.apiKeyAuth && (
          <HStack
            gap={2}
            className="text-muted-foreground items-center text-sm"
          >
            <Text as="span" variant="body-sm" className="w-20 shrink-0">
              {secretBindings.find((b) => SENSITIVE_KEYS.has(b)) ?? 'apiKey'}
            </Text>
            <Text as="span" variant="code">
              {'\u00d7'.repeat(8)}
            </Text>
          </HStack>
        )}

        {integration.authMethod === 'oauth2' && integration.oauth2Auth && (
          <HStack
            gap={2}
            className="text-muted-foreground items-center text-sm"
          >
            <Text as="span" variant="body-sm" className="w-20 shrink-0">
              {hasOAuth2Config
                ? t('integrations.manageDialog.connectedViaOAuth2')
                : 'accessToken'}
            </Text>
            <Text as="span" variant="code">
              {'\u00d7'.repeat(8)}
            </Text>
          </HStack>
        )}

        {integration.connectionConfig?.domain && (
          <HStack
            gap={2}
            className="text-muted-foreground items-center text-sm"
          >
            <Text as="span" variant="body-sm" className="w-20 shrink-0">
              domain
            </Text>
            <Text as="span" variant="code" truncate>
              {maskValue(integration.connectionConfig.domain)}
            </Text>
          </HStack>
        )}
        {integration.connectionConfig?.apiEndpoint && (
          <HStack
            gap={2}
            className="text-muted-foreground items-center text-sm"
          >
            <Text as="span" variant="body-sm" className="w-20 shrink-0">
              apiEndpoint
            </Text>
            <Text as="span" variant="code" truncate>
              {integration.connectionConfig.apiEndpoint}
            </Text>
          </HStack>
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
