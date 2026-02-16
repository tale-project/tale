'use client';

import type { Doc } from '@/convex/_generated/dataModel';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Stack } from '@/app/components/ui/layout/layout';

import { useIntegrationManage } from '../hooks/use-integration-manage';
import { IntegrationDetails } from './integration-details';
import { IntegrationActiveView } from './integration-manage/integration-active-view';
import { IntegrationCredentialsForm } from './integration-manage/integration-credentials-form';
import { IntegrationDeleteSection } from './integration-manage/integration-delete-section';
import { IntegrationIconUpload } from './integration-manage/integration-icon-upload';
import { IntegrationUpdateSection } from './integration-manage/integration-update-section';

interface IntegrationManageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  integration: Doc<'integrations'> & { iconUrl?: string | null };
}

export function IntegrationManageDialog({
  open,
  onOpenChange,
  integration,
}: IntegrationManageDialogProps) {
  const manage = useIntegrationManage(integration, onOpenChange, open);

  return (
    <Dialog
      open={open}
      onOpenChange={manage.handleOpenChange}
      title={integration.title}
      description={integration.description}
      size="lg"
      className="max-h-[85vh] overflow-x-hidden overflow-y-auto"
    >
      <Stack gap={4}>
        <IntegrationIconUpload
          iconUrl={manage.iconUrl}
          title={integration.title}
          isUploadingIcon={manage.isUploadingIcon}
          isActive={manage.isActive}
          isSql={manage.isSql}
          authMethod={integration.authMethod}
          operationCount={manage.operationCount}
          iconInputRef={manage.iconInputRef}
          onIconUpload={manage.handleIconUpload}
        />

        <IntegrationDetails integration={integration}>
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

        {manage.isActive ? (
          <IntegrationActiveView
            integration={integration}
            isSql={manage.isSql}
            busy={manage.busy}
            isSubmitting={manage.isSubmitting}
            isTesting={manage.isTesting}
            isSavingOAuth2={manage.isSavingOAuth2}
            hasOAuth2Config={manage.hasOAuth2Config}
            testResult={manage.testResult}
            secretBindings={manage.secretBindings}
            onTestConnection={manage.handleTestConnection}
            onDisconnect={manage.handleDisconnect}
            onReauthorize={manage.handleReauthorize}
            onDismissTestResult={() => manage.setTestResult(null)}
          />
        ) : (
          <IntegrationCredentialsForm
            integration={integration}
            isSql={manage.isSql}
            busy={manage.busy}
            isTesting={manage.isTesting}
            isSavingOAuth2={manage.isSavingOAuth2}
            selectedAuthMethod={manage.selectedAuthMethod}
            supportedMethods={manage.supportedMethods}
            hasMultipleAuthMethods={manage.hasMultipleAuthMethods}
            hasOAuth2Config={manage.hasOAuth2Config}
            hasOAuth2Credentials={manage.hasOAuth2Credentials}
            oauth2Fields={manage.oauth2Fields}
            oauth2FieldsComplete={manage.oauth2FieldsComplete}
            isEditingOAuth2={manage.isEditingOAuth2}
            credentials={manage.credentials}
            displayBindings={manage.displayBindings}
            sqlConfig={manage.sqlConfig}
            hasChanges={manage.hasChanges}
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
            onReauthorize={manage.handleReauthorize}
            onTestConnection={manage.handleTestConnection}
            onDismissTestResult={() => manage.setTestResult(null)}
          />
        )}

        <IntegrationDeleteSection
          confirmDelete={manage.confirmDelete}
          busy={manage.busy}
          onDelete={manage.handleDelete}
          onConfirmToggle={manage.setConfirmDelete}
        />
      </Stack>
    </Dialog>
  );
}
