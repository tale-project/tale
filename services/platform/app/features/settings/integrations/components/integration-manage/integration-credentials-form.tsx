'use client';

import { ExternalLink, Loader2, Pencil, Save } from 'lucide-react';

import type { Doc } from '@/convex/_generated/dataModel';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { HStack, Stack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

import { SENSITIVE_KEYS, maskValue } from '../../hooks/use-integration-manage';
import { TestResultFeedback } from './test-result-feedback';

interface IntegrationCredentialsFormProps {
  integration: Doc<'integrations'> & { iconUrl?: string | null };
  isSql: boolean;
  busy: boolean;
  isTesting: boolean;
  isSavingOAuth2: boolean;
  selectedAuthMethod: string;
  supportedMethods: string[];
  hasMultipleAuthMethods: boolean;
  hasOAuth2Config: boolean;
  hasOAuth2Credentials: boolean;
  oauth2Fields: {
    authorizationUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scopes: string;
  };
  oauth2FieldsComplete: boolean;
  isEditingOAuth2: boolean;
  credentials: Record<string, string>;
  displayBindings: string[];
  sqlConfig: Record<string, string>;
  hasChanges: boolean;
  testResult: { success: boolean; message: string } | null;
  onAuthMethodChange: (method: string) => void;
  onCredentialChange: (key: string, value: string) => void;
  onSqlConfigChange: (key: string, value: string) => void;
  onOAuth2FieldChange: (
    field: keyof IntegrationCredentialsFormProps['oauth2Fields'],
    value: string,
  ) => void;
  onEditOAuth2: (editing: boolean) => void;
  onSaveOAuth2: () => void;
  onReauthorize: () => void;
  onTestConnection: () => void;
  onDismissTestResult: () => void;
}

export function IntegrationCredentialsForm({
  integration,
  isSql,
  busy,
  isTesting,
  isSavingOAuth2,
  selectedAuthMethod,
  supportedMethods,
  hasMultipleAuthMethods,
  hasOAuth2Config,
  hasOAuth2Credentials,
  oauth2Fields,
  oauth2FieldsComplete,
  isEditingOAuth2,
  credentials,
  displayBindings,
  sqlConfig,
  hasChanges,
  testResult,
  onAuthMethodChange,
  onCredentialChange,
  onSqlConfigChange,
  onOAuth2FieldChange,
  onEditOAuth2,
  onSaveOAuth2,
  onReauthorize,
  onTestConnection,
  onDismissTestResult,
}: IntegrationCredentialsFormProps) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  return (
    <>
      {isSql && (
        <SqlConnectionSection
          integration={integration}
          sqlConfig={sqlConfig}
          busy={busy}
          onSqlConfigChange={onSqlConfigChange}
        />
      )}

      <Stack gap={3} className="border-border rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">
            {t('integrations.manageDialog.authentication')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {t('integrations.upload.updateCredentialsHint')}
          </p>
        </div>

        {hasMultipleAuthMethods && (
          <Select
            id="manage-auth-method"
            label={t('integrations.manageDialog.authenticationMethod')}
            options={supportedMethods.map((m) => ({
              value: m,
              label: t(`integrations.authMethods.${m}`),
            }))}
            value={selectedAuthMethod}
            onValueChange={onAuthMethodChange}
            disabled={busy}
          />
        )}

        {isSql && selectedAuthMethod === 'basic_auth' && (
          <>
            <Input
              id="manage-sql-username"
              label={t('integrations.manageDialog.username')}
              placeholder={integration.basicAuth?.username ?? ''}
              value={credentials['username'] ?? ''}
              onChange={(e) => onCredentialChange('username', e.target.value)}
              disabled={busy}
            />
            <Input
              id="manage-sql-password"
              label={t('integrations.manageDialog.password')}
              type="password"
              placeholder="••••••••"
              value={credentials['password'] ?? ''}
              onChange={(e) => onCredentialChange('password', e.target.value)}
              disabled={busy}
            />
          </>
        )}

        {selectedAuthMethod === 'oauth2' &&
          hasOAuth2Config &&
          (hasOAuth2Credentials && !isEditingOAuth2 ? (
            <OAuth2CredentialsSummary
              integration={integration}
              busy={busy}
              isSavingOAuth2={isSavingOAuth2}
              onReauthorize={onReauthorize}
              onEdit={() => onEditOAuth2(true)}
            />
          ) : (
            <OAuth2CredentialsEditor
              oauth2Fields={oauth2Fields}
              oauth2FieldsComplete={oauth2FieldsComplete}
              isEditingOAuth2={isEditingOAuth2}
              busy={busy}
              isSavingOAuth2={isSavingOAuth2}
              onFieldChange={onOAuth2FieldChange}
              onSave={onSaveOAuth2}
              onCancelEdit={() => onEditOAuth2(false)}
            />
          ))}

        {selectedAuthMethod === 'oauth2' && !hasOAuth2Config && (
          <>
            <Input
              id="manage-oauth2-access-token"
              label={t('integrations.manageDialog.accessToken')}
              type="password"
              placeholder="••••••••"
              value={credentials['accessToken'] ?? ''}
              onChange={(e) =>
                onCredentialChange('accessToken', e.target.value)
              }
              disabled={busy}
            />
            <Input
              id="manage-oauth2-refresh-token"
              label={t('integrations.manageDialog.refreshToken')}
              type="password"
              placeholder={t('integrations.manageDialog.optional')}
              value={credentials['refreshToken'] ?? ''}
              onChange={(e) =>
                onCredentialChange('refreshToken', e.target.value)
              }
              disabled={busy}
            />
          </>
        )}

        {displayBindings.map((binding) => {
          const isSensitive = SENSITIVE_KEYS.has(binding);
          return (
            <Input
              key={binding}
              id={`manage-credential-${binding}`}
              label={binding}
              type={isSensitive ? 'password' : 'text'}
              placeholder={isSensitive ? '••••••••' : ''}
              value={credentials[binding] ?? ''}
              onChange={(e) => onCredentialChange(binding, e.target.value)}
              disabled={busy}
            />
          );
        })}

        {!(selectedAuthMethod === 'oauth2' && hasOAuth2Config) && (
          <Button onClick={onTestConnection} disabled={busy} className="w-full">
            {isTesting ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                {t('integrations.manageDialog.connecting')}
              </>
            ) : hasChanges ? (
              t('integrations.manageDialog.testAndConnect')
            ) : (
              t('integrations.manageDialog.connect')
            )}
          </Button>
        )}

        {testResult && (
          <TestResultFeedback
            result={testResult}
            onDismiss={onDismissTestResult}
            closeLabel={tCommon('aria.close')}
          />
        )}
      </Stack>
    </>
  );
}

function SqlConnectionSection({
  integration,
  sqlConfig,
  busy,
  onSqlConfigChange,
}: {
  integration: Doc<'integrations'>;
  sqlConfig: Record<string, string>;
  busy: boolean;
  onSqlConfigChange: (key: string, value: string) => void;
}) {
  const { t } = useT('settings');

  return (
    <Stack gap={3} className="border-border rounded-lg border p-4">
      <HStack gap={2} className="items-center">
        <p className="text-sm font-medium">
          {t('integrations.manageDialog.databaseConnection')}
        </p>
        {integration.sqlConnectionConfig?.engine && (
          <Badge variant="outline" className="ml-auto text-xs">
            {integration.sqlConnectionConfig.engine}
          </Badge>
        )}
      </HStack>
      <Input
        id="manage-sql-server"
        label={t('integrations.manageDialog.server')}
        placeholder={integration.sqlConnectionConfig?.server ?? '192.168.1.100'}
        value={sqlConfig['server'] ?? ''}
        onChange={(e) => onSqlConfigChange('server', e.target.value)}
        disabled={busy}
      />
      <HStack gap={3}>
        <Input
          id="manage-sql-port"
          label={t('integrations.manageDialog.port')}
          type="number"
          placeholder={String(integration.sqlConnectionConfig?.port ?? 1433)}
          value={sqlConfig['port'] ?? ''}
          onChange={(e) => onSqlConfigChange('port', e.target.value)}
          disabled={busy}
        />
        <Input
          id="manage-sql-database"
          label={t('integrations.manageDialog.database')}
          placeholder={integration.sqlConnectionConfig?.database ?? ''}
          value={sqlConfig['database'] ?? ''}
          onChange={(e) => onSqlConfigChange('database', e.target.value)}
          disabled={busy}
        />
      </HStack>
    </Stack>
  );
}

function OAuth2CredentialsSummary({
  integration,
  busy,
  isSavingOAuth2,
  onReauthorize,
  onEdit,
}: {
  integration: Doc<'integrations'> & { iconUrl?: string | null };
  busy: boolean;
  isSavingOAuth2: boolean;
  onReauthorize: () => void;
  onEdit: () => void;
}) {
  const { t } = useT('settings');

  return (
    <>
      <Stack gap={2}>
        <HStack gap={2} className="text-muted-foreground items-center text-sm">
          <span className="w-20 shrink-0 text-xs">
            {t('integrations.manageDialog.clientId')}
          </span>
          <span className="truncate font-mono text-xs">
            {maskValue(integration.oauth2Config?.clientId ?? '')}
          </span>
        </HStack>
        <HStack gap={2} className="text-muted-foreground items-center text-sm">
          <span className="w-20 shrink-0 text-xs">
            {t('integrations.manageDialog.clientSecret')}
          </span>
          <span className="font-mono text-xs">{'\u00d7'.repeat(8)}</span>
        </HStack>
        {integration.oauth2Config?.scopes &&
          integration.oauth2Config.scopes.length > 0 && (
            <HStack
              gap={2}
              className="text-muted-foreground items-start text-sm"
            >
              <span className="w-20 shrink-0 text-xs">
                {t('integrations.manageDialog.scopes')}
              </span>
              <span className="font-mono text-xs break-all">
                {integration.oauth2Config.scopes.join(', ')}
              </span>
            </HStack>
          )}
      </Stack>
      <Button onClick={onReauthorize} disabled={busy} className="w-full">
        {isSavingOAuth2 ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t('integrations.manageDialog.savingCredentials')}
          </>
        ) : (
          <>
            <ExternalLink className="mr-2 size-4" />
            {t('integrations.authorize')}
          </>
        )}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={onEdit}
        disabled={busy}
        className="w-full"
      >
        <Pencil className="mr-2 size-3.5" />
        {t('integrations.manageDialog.updateCredentials')}
      </Button>
    </>
  );
}

function OAuth2CredentialsEditor({
  oauth2Fields,
  oauth2FieldsComplete,
  isEditingOAuth2,
  busy,
  isSavingOAuth2,
  onFieldChange,
  onSave,
  onCancelEdit,
}: {
  oauth2Fields: {
    authorizationUrl: string;
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    scopes: string;
  };
  oauth2FieldsComplete: boolean;
  isEditingOAuth2: boolean;
  busy: boolean;
  isSavingOAuth2: boolean;
  onFieldChange: (field: keyof typeof oauth2Fields, value: string) => void;
  onSave: () => void;
  onCancelEdit: () => void;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

  return (
    <>
      <Input
        id="manage-oauth2-authorization-url"
        label={t('integrations.manageDialog.authorizationUrl')}
        value={oauth2Fields.authorizationUrl}
        onChange={(e) => onFieldChange('authorizationUrl', e.target.value)}
        disabled={busy}
      />
      <Input
        id="manage-oauth2-token-url"
        label={t('integrations.manageDialog.tokenUrl')}
        value={oauth2Fields.tokenUrl}
        onChange={(e) => onFieldChange('tokenUrl', e.target.value)}
        disabled={busy}
      />
      <Input
        id="manage-oauth2-client-id"
        label={t('integrations.manageDialog.clientId')}
        value={oauth2Fields.clientId}
        onChange={(e) => onFieldChange('clientId', e.target.value)}
        disabled={busy}
      />
      <Input
        id="manage-oauth2-client-secret"
        label={t('integrations.manageDialog.clientSecret')}
        type="password"
        placeholder="••••••••"
        value={oauth2Fields.clientSecret}
        onChange={(e) => onFieldChange('clientSecret', e.target.value)}
        disabled={busy}
      />
      <Textarea
        id="manage-oauth2-scopes"
        label={t('integrations.manageDialog.scopes')}
        placeholder="channels:read, channels:history"
        rows={3}
        value={oauth2Fields.scopes}
        onChange={(e) => onFieldChange('scopes', e.target.value)}
        disabled={busy}
      />
      <Button
        onClick={onSave}
        disabled={busy || !oauth2FieldsComplete}
        className="w-full"
      >
        {isSavingOAuth2 ? (
          <>
            <Loader2 className="mr-2 size-4 animate-spin" />
            {t('integrations.manageDialog.savingCredentials')}
          </>
        ) : (
          <>
            <Save className="mr-2 size-4" />
            {t('integrations.manageDialog.saveCredentials')}
          </>
        )}
      </Button>
      {isEditingOAuth2 && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancelEdit}
          disabled={busy}
          className="w-full"
        >
          {tCommon('actions.cancel')}
        </Button>
      )}
    </>
  );
}
