'use client';

import { useAction } from 'convex/react';
import { Loader2, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { Text } from '@/app/components/ui/typography/text';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import {
  type Integration,
  useIntegrationManage,
} from '../hooks/use-integration-manage';
import { IntegrationDetails } from './integration-details';
import { IntegrationActiveView } from './integration-manage/integration-active-view';
import { IntegrationCredentialsForm } from './integration-manage/integration-credentials-form';
import { IntegrationIconUpload } from './integration-manage/integration-icon-upload';
import { IntegrationUpdateSection } from './integration-manage/integration-update-section';

interface IntegrationPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration: Integration;
}

export function IntegrationPanel({
  open,
  onOpenChange,
  integration,
}: IntegrationPanelProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const manage = useIntegrationManage(integration, onOpenChange, open);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const isCustom =
    typeof integration.metadata === 'object' &&
    integration.metadata !== null &&
    'source' in integration.metadata &&
    (integration.metadata as Record<string, unknown>).source === 'custom';

  // Lazy-load connector code from disk when panel opens
  const readIntegrationFn = useAction(
    api.integrations.file_actions.readIntegration,
  );
  const [connectorCode, setConnectorCode] = useState<string | undefined>(
    undefined,
  );
  const [isLoadingCode, setIsLoadingCode] = useState(false);
  useEffect(() => {
    if (!open) {
      setConnectorCode(undefined);
      setIsLoadingCode(false);
      return;
    }
    const slug = integration.name ?? '';
    if (!slug) return;
    setIsLoadingCode(true);
    void readIntegrationFn({ orgSlug: 'default', slug })
      .then((result) => {
        if (
          result &&
          typeof result === 'object' &&
          'ok' in result &&
          result.ok
        ) {
          setConnectorCode(
            typeof result.connectorCode === 'string'
              ? result.connectorCode
              : '',
          );
        } else {
          setConnectorCode('');
        }
      })
      .catch(() => {
        setConnectorCode('');
      })
      .finally(() => {
        setIsLoadingCode(false);
      });
  }, [open, integration.name, readIntegrationFn]);

  const enrichedIntegration = useMemo(() => {
    if (!connectorCode) return integration;
    return {
      ...integration,
      connector: {
        ...integration.connector,
        code: connectorCode,
      },
    };
  }, [integration, connectorCode]);

  const connectorCodeLoading = open && isLoadingCode;

  const isDetailsMode = manage.isActive ?? false;

  const panelTitle = isDetailsMode
    ? t('integrations.panel.integrationDetails')
    : t('integrations.panel.addIntegration');

  return (
    <Sheet
      open={open}
      onOpenChange={manage.handleOpenChange}
      title={panelTitle}
      size="md"
      hideClose
      className="flex flex-col gap-0 p-0"
    >
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b px-6 py-4"
      >
        <Text variant="label" className="text-base font-semibold">
          {panelTitle}
        </Text>
        <IconButton
          icon={X}
          aria-label={tCommon('aria.close')}
          variant="ghost"
          onClick={() => manage.handleOpenChange(false)}
        />
      </HStack>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <Stack gap={6}>
          <Stack gap={3}>
            <IntegrationIconUpload
              iconUrl={manage.iconUrl}
              title={integration.title}
              isUploadingIcon={manage.isUploadingIcon}
              isActive={isDetailsMode}
              isSql={manage.isSql}
              authMethod={integration.authMethod ?? ''}
              operationCount={manage.operationCount}
              iconInputRef={manage.iconInputRef}
              onIconUpload={manage.handleIconUpload}
            />

            {integration.description && (
              <Text variant="muted" className="text-sm leading-relaxed">
                {integration.description}
              </Text>
            )}

            <IntegrationDetails
              integration={enrichedIntegration}
              connectorCodeLoading={connectorCodeLoading}
            >
              <IntegrationUpdateSection
                parsedUpdate={manage.parsedUpdate}
                isParsingUpdate={manage.isParsingUpdate}
                isApplyingUpdate={manage.isApplyingUpdate}
                updateParseError={manage.updateParseError}
                busy={manage.busy}
                onFilesSelected={manage.handleUpdateFilesSelected}
                onApplyUpdate={manage.handleApplyUpdate}
                onClearUpdate={() => {
                  manage.setParsedUpdate(null);
                  manage.setUpdateParseError(null);
                }}
              />
            </IntegrationDetails>
          </Stack>

          {isDetailsMode ? (
            <IntegrationActiveView
              integration={integration}
              isSql={manage.isSql}
              busy={manage.busy}
              isSavingOAuth2={manage.isSavingOAuth2}
              hasOAuth2Config={manage.hasOAuth2Config}
              testResult={manage.testResult}
              secretBindings={manage.secretBindings}
              onReauthorize={manage.handleReauthorize}
              onDismissTestResult={() => manage.setTestResult(null)}
            />
          ) : (
            <IntegrationCredentialsForm
              integration={integration}
              isSql={manage.isSql}
              busy={manage.busy}
              isSavingOAuth2={manage.isSavingOAuth2}
              selectedAuthMethod={manage.selectedAuthMethod ?? ''}
              supportedMethods={manage.supportedMethods.filter(
                (m): m is string => m != null,
              )}
              hasMultipleAuthMethods={manage.hasMultipleAuthMethods}
              hasOAuth2Config={manage.hasOAuth2Config}
              hasOAuth2Credentials={manage.hasOAuth2Credentials}
              oauth2Fields={manage.oauth2Fields}
              oauth2FieldsComplete={manage.oauth2FieldsComplete}
              isEditingOAuth2={manage.isEditingOAuth2}
              credentials={manage.credentials}
              displayBindings={manage.displayBindings}
              sqlConfig={manage.sqlConfig}
              testResult={manage.testResult}
              onAuthMethodChange={(value) => {
                const method = manage.supportedMethods.find((m) => m === value);
                if (method) {
                  manage.setSelectedAuthMethod(method);
                  manage.setCredentials({});
                  manage.setTestResult(null);
                }
              }}
              onCredentialChange={(key, value) =>
                manage.setCredentials((prev) => ({ ...prev, [key]: value }))
              }
              onSqlConfigChange={(key, value) =>
                manage.setSqlConfig((prev) => ({ ...prev, [key]: value }))
              }
              onOAuth2FieldChange={(field, value) =>
                manage.setOAuth2Fields((prev) => ({ ...prev, [field]: value }))
              }
              onEditOAuth2={manage.setIsEditingOAuth2}
              onSaveOAuth2={manage.handleSaveOAuth2Only}
              onDismissTestResult={() => manage.setTestResult(null)}
            />
          )}
        </Stack>
      </div>

      <div className="border-border shrink-0 border-t px-6 py-4">
        {isDetailsMode ? (
          <Stack gap={3}>
            <HStack justify="between" align="center">
              <button
                type="button"
                onClick={() => setConfirmDisconnect(true)}
                disabled={manage.busy}
                className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors disabled:opacity-50"
              >
                {manage.isSubmitting ? (
                  <HStack gap={2} align="center">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t('integrations.disconnecting')}
                  </HStack>
                ) : (
                  t('integrations.disconnect')
                )}
              </button>
              <Button
                onClick={manage.handleTestConnection}
                disabled={manage.busy}
              >
                {manage.isTesting
                  ? t('integrations.manageDialog.testingConnection')
                  : t('integrations.manageDialog.testConnection')}
              </Button>
            </HStack>
            {isCustom && (
              <button
                type="button"
                onClick={() => manage.setConfirmDelete(true)}
                disabled={manage.busy}
                className="text-destructive hover:text-destructive/80 flex items-center gap-1.5 text-sm font-medium transition-colors disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
                {t('integrations.panel.deleteIntegration')}
              </button>
            )}
          </Stack>
        ) : (
          <HStack justify="end" align="center">
            <Button
              onClick={
                manage.selectedAuthMethod === 'oauth2' &&
                manage.hasOAuth2Config &&
                manage.hasOAuth2Credentials
                  ? manage.handleReauthorize
                  : manage.handleTestConnection
              }
              disabled={
                manage.busy ||
                (manage.selectedAuthMethod === 'oauth2' &&
                manage.hasOAuth2Config &&
                manage.hasOAuth2Credentials
                  ? false
                  : !manage.hasChanges)
              }
            >
              {manage.isTesting || manage.isSavingOAuth2 ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  {t('integrations.manageDialog.connecting')}
                </>
              ) : (
                t('integrations.panel.connectName', {
                  name: integration.title,
                })
              )}
            </Button>
          </HStack>
        )}
      </div>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={t('integrations.panel.disconnectConfirmTitle')}
        description={t('integrations.panel.disconnectConfirmDescription')}
        confirmText={t('integrations.disconnect')}
        isLoading={manage.isSubmitting}
        onConfirm={() => {
          void manage.handleDisconnect();
          setConfirmDisconnect(false);
        }}
      />

      <DeleteDialog
        open={manage.confirmDelete}
        onOpenChange={manage.setConfirmDelete}
        title={t('integrations.panel.deleteConfirmTitle')}
        description={t('integrations.panel.deleteConfirmDescription')}
        isDeleting={manage.busy}
        onDelete={manage.handleUninstall}
      />
    </Sheet>
  );
}
