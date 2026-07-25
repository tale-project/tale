'use client';

import type { useIntegrationManage } from '../../hooks/use-integration-manage';
import { type Integration } from '../../hooks/use-integration-manage';
import { IntegrationCredentialsForm } from './integration-credentials-form';

type IntegrationManage = ReturnType<typeof useIntegrationManage>;

/**
 * The wiring between a `useIntegrationManage` instance and the presentational
 * `IntegrationCredentialsForm`. Lifted out of `IntegrationPanel` so the settings
 * panel and the app-install wizard render the exact same credential form from
 * one place (no duplicated prop plumbing that could drift). Credential plaintext
 * handling lives entirely inside `useIntegrationManage` — this component only
 * forwards its state and setters.
 */
export function IntegrationCredentialsFormConnected({
  integration,
  manage,
}: {
  integration: Integration;
  manage: IntegrationManage;
}) {
  return (
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
      smtpSeparate={manage.smtpSeparate}
      onSmtpSeparateChange={manage.handleSmtpSeparateChange}
      fromSameAsUsername={manage.fromSameAsUsername}
      onFromSameAsUsernameChange={manage.handleFromSameAsUsernameChange}
      displayBindings={manage.displayBindings}
      editableConfigFields={manage.editableConfigFields}
      configValues={manage.configValues}
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
      onConfigValueChange={(key, value) =>
        manage.setConfigValues((prev) => ({ ...prev, [key]: value }))
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
  );
}
