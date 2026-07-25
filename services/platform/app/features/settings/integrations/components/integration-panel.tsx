'use client';

import { Button } from '@tale/ui/button';
import { IconButton } from '@tale/ui/icon-button';
import { HStack, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useAction } from 'convex/react';
import { Copy, Download, Loader2, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { DeleteDialog } from '@/app/components/ui/dialog/delete-dialog';
import { ItemPreview } from '@/app/components/ui/dialog/item-preview';
import { Sheet } from '@/app/components/ui/overlays/sheet';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import {
  type Integration,
  useIntegrationManage,
} from '../hooks/use-integration-manage';
import { IntegrationDetails } from './integration-details';
import { IntegrationActiveView } from './integration-manage/integration-active-view';
import { IntegrationCredentialsFormConnected } from './integration-manage/integration-credentials-form-connected';
import { IntegrationIconUpload } from './integration-manage/integration-icon-upload';
import { IntegrationUpdateSection } from './integration-manage/integration-update-section';
import { SlackNotificationConfig } from './integration-manage/slack-notification-config';

interface IntegrationPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration: Integration;
  organizationId: string;
  /** Download this integration's files as a zip (footer Export action). */
  onExport?: () => void;
  /** Parent-owned export in-flight state, reflected on the Export button. */
  isExporting?: boolean;
  /** Clone this integration under a new slug (footer Duplicate action). */
  onDuplicate?: () => void;
  /** Parent-owned duplicate in-flight state, reflected on the Duplicate button. */
  isDuplicating?: boolean;
}

export function IntegrationPanel({
  open,
  onOpenChange,
  integration,
  organizationId,
  onExport,
  isExporting,
  onDuplicate,
  isDuplicating,
}: IntegrationPanelProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const manage = useIntegrationManage(
    integration,
    onOpenChange,
    open,
    organizationId,
  );
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

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
    void readIntegrationFn({ organizationId, slug })
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
  }, [open, integration.name, organizationId, readIntegrationFn]);

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

  // Sheet title is the integration's identity (same name as the catalog card),
  // not the generic mode label — "Add integration" / "Integration details"
  // don't answer "which one am I connecting?" when the panel opens.
  const panelTitle = integration.title;

  // A human-recognizable identifier for the confirm dialogs. Several instances
  // of one integration can share a base title and differ only by this identity,
  // so a confirm that shows only the title can't tell them apart. Prefer the
  // login/host/domain that distinguishes an instance; never a secret
  // (passwords and keys live encrypted and are never surfaced).
  const identity =
    integration.basicAuth?.username ??
    integration.sqlConnectionConfig?.server ??
    (typeof integration.connectionConfig?.domain === 'string'
      ? integration.connectionConfig.domain
      : undefined) ??
    (typeof integration.connectionConfig?.apiEndpoint === 'string'
      ? integration.connectionConfig.apiEndpoint
      : undefined);

  // Footer secondary actions (Export, Duplicate) — at most two, so they render
  // inline. A popup for one or two items is more friction than it saves; if a
  // third ever lands, collapse them then.
  const secondaryActions = [
    ...(onExport
      ? [
          {
            key: 'export',
            label: tCommon('actions.export'),
            icon: Download,
            onClick: onExport,
            disabled: manage.busy || isExporting,
            loading: isExporting ?? false,
          },
        ]
      : []),
    ...(onDuplicate
      ? [
          {
            key: 'duplicate',
            label: tCommon('actions.duplicate'),
            icon: Copy,
            onClick: onDuplicate,
            disabled: manage.busy || isDuplicating,
            loading: isDuplicating ?? false,
          },
        ]
      : []),
  ];

  return (
    <Sheet
      open={open}
      onOpenChange={manage.handleOpenChange}
      title={panelTitle}
      size="md"
      hideClose
      className="flex flex-col gap-0 overflow-y-hidden p-0"
    >
      <HStack
        justify="between"
        align="center"
        className="border-border shrink-0 border-b p-4 sm:px-6 sm:py-4"
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

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:px-6 sm:py-5">
        <Stack gap={6}>
          <Stack gap={4}>
            <IntegrationIconUpload
              iconUrl={manage.iconUrl}
              title={integration.title}
              isUploadingIcon={manage.isUploadingIcon}
              isActive={isDetailsMode}
              status={
                typeof integration.status === 'string'
                  ? integration.status
                  : undefined
              }
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
            <Stack gap={4}>
              <IntegrationActiveView
                integration={integration}
                isSql={manage.isSql}
                busy={manage.busy}
                isSavingOAuth2={manage.isSavingOAuth2}
                isTesting={manage.isTesting}
                isDisconnecting={manage.isSubmitting}
                hasOAuth2Config={manage.hasOAuth2Config}
                testResult={manage.testResult}
                editableConfigFields={manage.editableConfigFields}
                onReauthorize={manage.handleReauthorize}
                onTestConnection={manage.handleTestConnection}
                onDisconnect={() => setConfirmDisconnect(true)}
                onDismissTestResult={() => manage.setTestResult(null)}
              />
              {integration.name === 'slack' && (
                <SlackNotificationConfig
                  integration={integration}
                  organizationId={organizationId}
                />
              )}
            </Stack>
          ) : (
            <IntegrationCredentialsFormConnected
              integration={integration}
              manage={manage}
            />
          )}
        </Stack>
      </div>

      <div className="border-border shrink-0 border-t p-4 sm:px-6 sm:py-4">
        {isDetailsMode ? (
          <HStack justify="between" align="center" gap={2}>
            {secondaryActions.length > 0 ? (
              <HStack gap={2} align="center">
                {secondaryActions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <Button
                      key={action.key}
                      type="button"
                      variant="ghost"
                      onClick={action.onClick}
                      disabled={action.disabled}
                    >
                      {action.loading ? (
                        <Loader2 className="mr-2 size-3.5 animate-spin" />
                      ) : (
                        <Icon className="mr-2 size-3.5" />
                      )}
                      {action.label}
                    </Button>
                  );
                })}
              </HStack>
            ) : (
              <span />
            )}
            <Button
              type="button"
              onClick={() => manage.setConfirmDelete(true)}
              disabled={manage.busy}
              variant="destructive"
            >
              <Trash2 className="mr-2 size-3.5" />
              {t('integrations.panel.deleteIntegration')}
            </Button>
          </HStack>
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
              disabledReason={
                !manage.busy &&
                !(
                  manage.selectedAuthMethod === 'oauth2' &&
                  manage.hasOAuth2Config &&
                  manage.hasOAuth2Credentials
                ) &&
                !manage.hasChanges
                  ? manage.selectedAuthMethod === 'oauth2' &&
                    manage.hasOAuth2Config
                    ? t('integrations.panel.saveCredentialsThenConnect')
                    : t('integrations.panel.enterCredentialsToConnect')
                  : undefined
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
          // Keep the dialog open (and showing its loading state) until the
          // disconnect resolves; `handleDisconnect` swallows its own errors
          // and surfaces a toast, so closing afterwards is always safe.
          void manage.handleDisconnect().finally(() => {
            setConfirmDisconnect(false);
          });
        }}
      >
        <ItemPreview primary={panelTitle} secondary={identity} />
      </ConfirmDialog>

      <DeleteDialog
        open={manage.confirmDelete}
        onOpenChange={manage.setConfirmDelete}
        title={t('integrations.panel.deleteConfirmTitle')}
        description={t('integrations.panel.deleteConfirmDescription')}
        preview={{ primary: panelTitle, secondary: identity }}
        isDeleting={manage.busy}
        onDelete={manage.handleUninstall}
      />
    </Sheet>
  );
}
