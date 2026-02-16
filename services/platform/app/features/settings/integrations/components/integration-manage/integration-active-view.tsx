'use client';

import { ExternalLink, Loader2 } from 'lucide-react';

import type { Doc } from '@/convex/_generated/dataModel';

import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
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
      <Stack gap={2} className="border-border rounded-lg border p-4">
        <p className="text-sm font-medium">
          {t('integrations.manageDialog.authentication')}
        </p>

        {isSql && integration.sqlConnectionConfig?.server && (
          <HStack
            gap={2}
            className="text-muted-foreground items-center text-sm"
          >
            <span className="w-20 shrink-0 text-xs">
              {t('integrations.manageDialog.server')}
            </span>
            <span className="font-mono text-xs">
              {maskValue(integration.sqlConnectionConfig.server)}
            </span>
          </HStack>
        )}

        {integration.authMethod === 'basic_auth' &&
          integration.basicAuth?.username && (
            <>
              <HStack
                gap={2}
                className="text-muted-foreground items-center text-sm"
              >
                <span className="w-20 shrink-0 text-xs">
                  {t('integrations.manageDialog.username')}
                </span>
                <span className="font-mono text-xs">
                  {maskValue(integration.basicAuth.username)}
                </span>
              </HStack>
              <HStack
                gap={2}
                className="text-muted-foreground items-center text-sm"
              >
                <span className="w-20 shrink-0 text-xs">
                  {t('integrations.manageDialog.password')}
                </span>
                <span className="font-mono text-xs">{'\u00d7'.repeat(8)}</span>
              </HStack>
            </>
          )}

        {integration.authMethod === 'api_key' && integration.apiKeyAuth && (
          <HStack
            gap={2}
            className="text-muted-foreground items-center text-sm"
          >
            <span className="w-20 shrink-0 text-xs">
              {secretBindings.find((b) => SENSITIVE_KEYS.has(b)) ?? 'apiKey'}
            </span>
            <span className="font-mono text-xs">{'\u00d7'.repeat(8)}</span>
          </HStack>
        )}

        {integration.authMethod === 'oauth2' && integration.oauth2Auth && (
          <HStack
            gap={2}
            className="text-muted-foreground items-center text-sm"
          >
            <span className="w-20 shrink-0 text-xs">
              {hasOAuth2Config
                ? t('integrations.manageDialog.connectedViaOAuth2')
                : 'accessToken'}
            </span>
            <span className="font-mono text-xs">{'\u00d7'.repeat(8)}</span>
          </HStack>
        )}

        {integration.connectionConfig?.domain && (
          <HStack
            gap={2}
            className="text-muted-foreground items-center text-sm"
          >
            <span className="w-20 shrink-0 text-xs">domain</span>
            <span className="truncate font-mono text-xs">
              {maskValue(integration.connectionConfig.domain)}
            </span>
          </HStack>
        )}
        {integration.connectionConfig?.apiEndpoint && (
          <HStack
            gap={2}
            className="text-muted-foreground items-center text-sm"
          >
            <span className="w-20 shrink-0 text-xs">apiEndpoint</span>
            <span className="truncate font-mono text-xs">
              {integration.connectionConfig.apiEndpoint}
            </span>
          </HStack>
        )}
      </Stack>

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

      <HStack gap={2}>
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
      </HStack>

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
