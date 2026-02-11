'use client';

import { useMutation } from 'convex/react';
import {
  CheckCircle,
  ExternalLink,
  XCircle,
  Loader2,
  Puzzle,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { Image } from '@/app/components/ui/data-display/image';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { StatusIndicator } from '@/app/components/ui/feedback/status-indicator';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Center, Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useDeleteIntegration } from '../hooks/use-delete-integration';
import { useGenerateIntegrationOAuth2Url } from '../hooks/use-generate-integration-oauth2-url';
import { useSaveOAuth2Credentials } from '../hooks/use-save-oauth2-credentials';
import { useTestIntegration } from '../hooks/use-test-integration';
import { useUpdateIntegration } from '../hooks/use-update-integration';
import { IntegrationDetails } from './integration-details';

const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'accessToken',
  'apiKey',
  'key',
  'refreshToken',
]);

// Keys with dedicated input fields per auth method (excluded from generic secretBindings inputs).
// api_key/bearer_token use dynamic matching via SENSITIVE_KEYS, so no fixed keys to exclude.
const AUTH_HANDLED_KEYS: Record<string, string[]> = {
  api_key: [],
  bearer_token: [],
  basic_auth: ['username', 'password'],
  oauth2: ['accessToken', 'refreshToken'],
};

function maskValue(value: string, visibleChars = 6): string {
  if (value.length <= visibleChars) return '×'.repeat(8);
  return value.slice(0, visibleChars) + '×'.repeat(7);
}

const MAX_ICON_SIZE = 256 * 1024; // 256KB
const ACCEPTED_ICON_TYPES = new Set([
  'image/png',
  'image/svg+xml',
  'image/jpeg',
  'image/webp',
]);

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
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [sqlConfig, setSqlConfig] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [optimisticActive, setOptimisticActive] = useState<boolean | null>(
    null,
  );
  const [optimisticIconUrl, setOptimisticIconUrl] = useState<string | null>(
    null,
  );
  const iconInputRef = useRef<HTMLInputElement>(null);

  // Clear optimistic overrides when Convex reactive query updates the real data
  useEffect(() => {
    setOptimisticActive(null);
  }, [integration.isActive]);

  useEffect(() => {
    if (integration.iconUrl) {
      setOptimisticIconUrl(null);
    }
  }, [integration.iconUrl]);

  const isActive = optimisticActive ?? integration.isActive;
  const iconUrl = optimisticIconUrl ?? integration.iconUrl;

  const updateIntegration = useUpdateIntegration();
  const testConnection = useTestIntegration();
  const deleteIntegration = useDeleteIntegration({
    integrationName: integration.name,
  });
  const generateUploadUrl = useMutation(api.files.mutations.generateUploadUrl);
  const updateIcon = useMutation(api.integrations.mutations.updateIcon);
  const generateOAuth2Url = useGenerateIntegrationOAuth2Url();
  const saveOAuth2Credentials = useSaveOAuth2Credentials();

  const hasOAuth2Config = !!integration.oauth2Config;

  // Auth method selection (for integrations supporting multiple methods)
  const supportedMethods = useMemo(
    () => integration.supportedAuthMethods ?? [integration.authMethod],
    [integration.supportedAuthMethods, integration.authMethod],
  );
  const hasMultipleAuthMethods = supportedMethods.length > 1;
  const [selectedAuthMethod, setSelectedAuthMethod] = useState(
    integration.authMethod,
  );

  // Reset selected method when integration changes
  useEffect(() => {
    setSelectedAuthMethod(integration.authMethod);
  }, [integration.authMethod]);

  // OAuth2 client credential state (for authorization flow)
  const [oauth2Fields, setOAuth2Fields] = useState({
    authorizationUrl: '',
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
  });
  const [isSavingOAuth2, setIsSavingOAuth2] = useState(false);

  // Pre-fill OAuth2 fields from integration config when dialog opens
  useEffect(() => {
    const config = integration.oauth2Config;
    if (config) {
      setOAuth2Fields((prev) => ({
        authorizationUrl: prev.authorizationUrl || config.authorizationUrl,
        tokenUrl: prev.tokenUrl || config.tokenUrl,
        clientId: prev.clientId || config.clientId || '',
        clientSecret: prev.clientSecret,
      }));
    }
  }, [integration.oauth2Config]);

  const isSql = integration.type === 'sql';

  const secretBindings = useMemo(
    () => integration.connector?.secretBindings ?? [],
    [integration.connector],
  );

  // For SQL basic_auth, skip username/password from secretBindings since they have dedicated inputs
  const displayBindings = useMemo(() => {
    if (isSql && selectedAuthMethod === 'basic_auth') {
      return secretBindings.filter((b) => b !== 'username' && b !== 'password');
    }
    if (selectedAuthMethod === 'oauth2') {
      return secretBindings.filter(
        (b) => b !== 'accessToken' && b !== 'refreshToken',
      );
    }
    return secretBindings;
  }, [isSql, selectedAuthMethod, secretBindings]);

  const hasCredentialChanges = Object.values(credentials).some(
    (v) => v.trim().length > 0,
  );
  const hasSqlConfigChanges = Object.values(sqlConfig).some(
    (v) => v.trim().length > 0,
  );
  const hasChanges = hasCredentialChanges || hasSqlConfigChanges;

  const busy = isSubmitting || isTesting || isSavingOAuth2;

  // Prevent closing while busy
  const busyRef = useRef(false);
  busyRef.current = busy;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const handleOpenChange = useCallback((open: boolean) => {
    if (open || !busyRef.current) {
      onOpenChangeRef.current(open);
    }
  }, []);

  const handleIconUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > MAX_ICON_SIZE) {
        toast({
          title: t('integrations.upload.iconTooLarge'),
          variant: 'destructive',
        });
        return;
      }

      if (!ACCEPTED_ICON_TYPES.has(file.type)) {
        toast({
          title: t('integrations.upload.invalidIconFormat'),
          variant: 'destructive',
        });
        return;
      }

      setIsUploadingIcon(true);
      const previewUrl = URL.createObjectURL(file);
      try {
        const uploadUrl = await generateUploadUrl();
        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        });

        if (!uploadResponse.ok) {
          throw new Error('Upload failed');
        }

        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fetch response.json() returns unknown
        const { storageId } = (await uploadResponse.json()) as {
          storageId: string;
        };

        await updateIcon({
          integrationId: integration._id,
          iconStorageId: toId<'_storage'>(storageId),
        });

        setOptimisticIconUrl(previewUrl);
        toast({
          title: t('integrations.updateSuccessful'),
          variant: 'success',
        });
      } catch {
        toast({
          title: t('integrations.updateFailed'),
          variant: 'destructive',
        });
      } finally {
        setIsUploadingIcon(false);
        if (iconInputRef.current) {
          iconInputRef.current.value = '';
        }
      }
    },
    [generateUploadUrl, updateIcon, integration._id, t],
  );

  const buildUpdateArgs = useCallback(() => {
    const authMethod = selectedAuthMethod;
    const updateArgs: Record<string, unknown> = {
      integrationId: integration._id,
      isActive: true,
      status: 'active',
    };

    // Include authMethod when switching to a different method
    if (selectedAuthMethod !== integration.authMethod) {
      updateArgs.authMethod = selectedAuthMethod;
    }

    if (authMethod === 'api_key') {
      const keyBinding = secretBindings.find((b) => SENSITIVE_KEYS.has(b));
      const keyValue = credentials[keyBinding ?? secretBindings[0]];
      if (keyValue?.trim()) {
        updateArgs.apiKeyAuth = { key: keyValue };
      }
    } else if (authMethod === 'basic_auth') {
      if (credentials['username']?.trim() || credentials['password']?.trim()) {
        updateArgs.basicAuth = {
          username:
            credentials['username']?.trim() ||
            integration.basicAuth?.username ||
            '',
          password: credentials['password']?.trim() || '',
        };
      }
    } else if (authMethod === 'oauth2') {
      if (credentials['accessToken']?.trim()) {
        updateArgs.oauth2Auth = {
          accessToken: credentials['accessToken'],
          refreshToken: credentials['refreshToken']?.trim() || undefined,
        };
      }
    }

    const connectionUpdates: Record<string, string> = {};
    const authHandledKeys = new Set(AUTH_HANDLED_KEYS[authMethod] ?? []);
    for (const binding of secretBindings) {
      if (
        !SENSITIVE_KEYS.has(binding) &&
        !authHandledKeys.has(binding) &&
        credentials[binding]?.trim()
      ) {
        connectionUpdates[binding] = credentials[binding];
      }
    }
    if (Object.keys(connectionUpdates).length > 0) {
      updateArgs.connectionConfig = {
        ...integration.connectionConfig,
        ...connectionUpdates,
      };
    }

    if (isSql && hasSqlConfigChanges) {
      const existing = integration.sqlConnectionConfig;
      updateArgs.sqlConnectionConfig = {
        engine: existing?.engine ?? 'mssql',
        server: sqlConfig['server']?.trim() || existing?.server,
        port: sqlConfig['port']?.trim()
          ? Number(sqlConfig['port'])
          : existing?.port,
        database: sqlConfig['database']?.trim() || existing?.database,
        readOnly: existing?.readOnly,
        options: existing?.options,
        security: existing?.security,
      };
    }

    return updateArgs;
  }, [
    credentials,
    sqlConfig,
    isSql,
    hasSqlConfigChanges,
    selectedAuthMethod,
    integration,
    secretBindings,
  ]);

  const handleTestConnection = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      if (isSql && hasChanges) {
        // SQL: test first with inline credentials, save only on success
        const updateArgs = buildUpdateArgs();
        const testArgs: Parameters<typeof testConnection>[0] = {
          integrationId: integration._id,
        };

        // Build inline SQL config for pre-save testing
        if (hasSqlConfigChanges) {
          const existing = integration.sqlConnectionConfig;
          testArgs.sqlConnectionConfig = {
            engine: existing?.engine ?? 'mssql',
            server: sqlConfig['server']?.trim() || existing?.server,
            port: sqlConfig['port']?.trim()
              ? Number(sqlConfig['port'])
              : existing?.port,
            database: sqlConfig['database']?.trim() || existing?.database,
            readOnly: existing?.readOnly,
            options: existing?.options,
            security: existing?.security,
          };
        }
        if (
          credentials['username']?.trim() ||
          credentials['password']?.trim()
        ) {
          testArgs.basicAuth = {
            username:
              credentials['username']?.trim() ||
              integration.basicAuth?.username ||
              '',
            password: credentials['password']?.trim() || '',
          };
        }

        const result = await testConnection(testArgs);

        if (result.success) {
          // Test passed — now persist to DB
          await updateIntegration(
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic payload
            updateArgs as Parameters<typeof updateIntegration>[0],
          );
          setOptimisticActive(true);
          setCredentials({});
          setSqlConfig({});
        }

        setTestResult({
          success: result.success,
          message:
            result.message ??
            (result.success
              ? t('integrations.connectionSuccessful')
              : t('integrations.connectionTestFailed')),
        });
      } else {
        // REST: test first with inline credentials, save only on success
        const testArgs: Parameters<typeof testConnection>[0] = {
          integrationId: integration._id,
        };

        if (hasChanges) {
          // Build inline REST credentials for pre-save testing
          const authMethod = selectedAuthMethod;

          if (authMethod === 'api_key') {
            const keyBinding = secretBindings.find((b) =>
              SENSITIVE_KEYS.has(b),
            );
            const keyValue = credentials[keyBinding ?? secretBindings[0]];
            if (keyValue?.trim()) {
              testArgs.apiKeyAuth = { key: keyValue };
            }
          } else if (authMethod === 'basic_auth') {
            if (
              credentials['username']?.trim() ||
              credentials['password']?.trim()
            ) {
              testArgs.basicAuth = {
                username:
                  credentials['username']?.trim() ||
                  integration.basicAuth?.username ||
                  '',
                password: credentials['password']?.trim() || '',
              };
            }
          } else if (authMethod === 'oauth2') {
            if (credentials['accessToken']?.trim()) {
              testArgs.oauth2Auth = {
                accessToken: credentials['accessToken'],
                refreshToken: credentials['refreshToken']?.trim() || undefined,
              };
            }
          }

          // Non-sensitive connection config values (e.g. apiEndpoint, domain)
          const connectionUpdates: Record<string, string> = {};
          const authHandledKeys = new Set(AUTH_HANDLED_KEYS[authMethod] ?? []);
          for (const binding of secretBindings) {
            if (
              !SENSITIVE_KEYS.has(binding) &&
              !authHandledKeys.has(binding) &&
              credentials[binding]?.trim()
            ) {
              connectionUpdates[binding] = credentials[binding];
            }
          }
          if (Object.keys(connectionUpdates).length > 0) {
            testArgs.connectionConfig = {
              ...integration.connectionConfig,
              ...connectionUpdates,
            };
          }
        }

        const result = await testConnection(testArgs);

        if (result.success && hasChanges) {
          // Test passed — now persist to DB
          const updateArgs = buildUpdateArgs();
          await updateIntegration(
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic payload
            updateArgs as Parameters<typeof updateIntegration>[0],
          );
          setOptimisticActive(true);
          setCredentials({});
          setSqlConfig({});
        } else if (result.success) {
          setOptimisticActive(true);
        }

        setTestResult({
          success: result.success,
          message:
            result.message ??
            (result.success
              ? t('integrations.connectionSuccessful')
              : t('integrations.connectionTestFailed')),
        });
      }
    } catch (error) {
      setTestResult({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : t('integrations.failedToTestConnection'),
      });
    } finally {
      setIsTesting(false);
    }
  }, [
    isSql,
    hasChanges,
    hasSqlConfigChanges,
    sqlConfig,
    credentials,
    secretBindings,
    selectedAuthMethod,
    integration,
    buildUpdateArgs,
    updateIntegration,
    testConnection,
    t,
  ]);

  const handleDisconnect = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await updateIntegration({
        integrationId: integration._id,
        isActive: false,
        status: 'inactive',
      });
      setOptimisticActive(false);
      toast({
        title: t('integrations.toast.disconnected'),
        description: t('integrations.disconnectedSuccessfully', {
          provider: integration.title,
        }),
      });
      setCredentials({});
      setSqlConfig({});
      setTestResult(null);
    } catch (error) {
      toast({
        title: t('integrations.toast.disconnectFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('integrations.failedToDisconnect', {
                provider: integration.title,
              }),
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [updateIntegration, integration, t]);

  const handleSaveAndAuthorize = useCallback(async () => {
    if (
      !oauth2Fields.authorizationUrl.trim() ||
      !oauth2Fields.tokenUrl.trim() ||
      !oauth2Fields.clientId.trim() ||
      !oauth2Fields.clientSecret.trim()
    ) {
      return;
    }

    setIsSavingOAuth2(true);
    try {
      await saveOAuth2Credentials({
        integrationId: integration._id,
        authorizationUrl: oauth2Fields.authorizationUrl.trim(),
        tokenUrl: oauth2Fields.tokenUrl.trim(),
        scopes: integration.oauth2Config?.scopes,
        clientId: oauth2Fields.clientId.trim(),
        clientSecret: oauth2Fields.clientSecret.trim(),
      });

      const authUrl = await generateOAuth2Url({
        integrationId: integration._id,
        organizationId: integration.organizationId,
      });

      window.location.href = authUrl;
    } catch (error) {
      toast({
        title: t('integrations.manageDialog.oauth2AuthorizationFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
      setIsSavingOAuth2(false);
    }
  }, [
    oauth2Fields,
    integration._id,
    integration.organizationId,
    integration.oauth2Config?.scopes,
    saveOAuth2Credentials,
    generateOAuth2Url,
    t,
  ]);

  const handleReauthorize = useCallback(async () => {
    setIsSavingOAuth2(true);
    try {
      const authUrl = await generateOAuth2Url({
        integrationId: integration._id,
        organizationId: integration.organizationId,
      });
      window.location.href = authUrl;
    } catch (error) {
      toast({
        title: t('integrations.manageDialog.oauth2AuthorizationFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
      setIsSavingOAuth2(false);
    }
  }, [integration._id, integration.organizationId, generateOAuth2Url, t]);

  const oauth2FieldsComplete =
    oauth2Fields.authorizationUrl.trim().length > 0 &&
    oauth2Fields.tokenUrl.trim().length > 0 &&
    oauth2Fields.clientId.trim().length > 0 &&
    oauth2Fields.clientSecret.trim().length > 0;

  const handleDelete = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await deleteIntegration({ integrationId: integration._id });
      toast({
        title: t('integrations.manageDialog.deleted'),
        description: t('integrations.manageDialog.deletedDescription', {
          name: integration.title,
        }),
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: t('integrations.manageDialog.deleteFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
      setConfirmDelete(false);
    }
  }, [deleteIntegration, integration, onOpenChange, t]);

  const operationCount =
    (integration.connector?.operations?.length ?? 0) +
    (integration.sqlOperations?.length ?? 0);

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={integration.title}
      description={integration.description}
      size="lg"
      className="max-h-[85vh] overflow-x-hidden overflow-y-auto"
    >
      <Stack gap={4}>
        {/* Status & info */}
        <HStack gap={3} className="items-center">
          <button
            type="button"
            className="group relative shrink-0"
            onClick={() => iconInputRef.current?.click()}
            disabled={isUploadingIcon}
            aria-label={t('integrations.upload.changeIcon')}
          >
            <Center className="border-border group-hover:border-primary/50 size-10 rounded-md border transition-colors">
              {isUploadingIcon ? (
                <Loader2 className="size-4 animate-spin" />
              ) : iconUrl ? (
                <Image
                  src={iconUrl}
                  alt={integration.title}
                  className="size-5 rounded object-contain"
                />
              ) : (
                <Puzzle className="size-5" />
              )}
            </Center>
            <span className="bg-background border-border absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border shadow-sm">
              <Upload className="size-2" />
            </span>
          </button>
          <input
            ref={iconInputRef}
            type="file"
            accept=".png,.svg,.jpg,.jpeg,.webp"
            className="hidden"
            onChange={handleIconUpload}
            aria-label={t('integrations.upload.changeIcon')}
          />
          <StatusIndicator variant={isActive ? 'success' : 'warning'}>
            {isActive
              ? t('integrations.upload.active')
              : t('integrations.upload.inactive')}
          </StatusIndicator>
          {operationCount > 0 && (
            <HStack gap={2} className="ml-auto flex-wrap">
              <Badge variant="outline" className="text-xs">
                {operationCount}{' '}
                {t('integrations.upload.operations').toLowerCase()}
              </Badge>
              {isSql && (
                <Badge variant="outline" className="text-xs">
                  SQL
                </Badge>
              )}
              <Badge variant="outline" className="text-xs">
                {integration.authMethod}
              </Badge>
            </HStack>
          )}
        </HStack>

        {/* Operations & connector details */}
        <IntegrationDetails integration={integration} />

        {/* Active: read-only credentials + Disconnect */}
        {isActive ? (
          <Stack gap={3}>
            {/* Masked credentials summary */}
            <Stack gap={2} className="border-border rounded-lg border p-4">
              <p className="text-sm font-medium">
                {t('integrations.manageDialog.authentication')}
              </p>

              {/* SQL: show server/database info */}
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

              {/* basic_auth: username + masked password */}
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
                      <span className="font-mono text-xs">{'×'.repeat(8)}</span>
                    </HStack>
                  </>
                )}

              {/* api_key: show masked */}
              {integration.authMethod === 'api_key' &&
                integration.apiKeyAuth && (
                  <HStack
                    gap={2}
                    className="text-muted-foreground items-center text-sm"
                  >
                    <span className="w-20 shrink-0 text-xs">
                      {secretBindings.find((b) => SENSITIVE_KEYS.has(b)) ??
                        'apiKey'}
                    </span>
                    <span className="font-mono text-xs">{'×'.repeat(8)}</span>
                  </HStack>
                )}

              {/* oauth2: show connected state */}
              {integration.authMethod === 'oauth2' &&
                integration.oauth2Auth && (
                  <HStack
                    gap={2}
                    className="text-muted-foreground items-center text-sm"
                  >
                    <span className="w-20 shrink-0 text-xs">
                      {hasOAuth2Config
                        ? t('integrations.manageDialog.connectedViaOAuth2')
                        : 'accessToken'}
                    </span>
                    <span className="font-mono text-xs">{'×'.repeat(8)}</span>
                  </HStack>
                )}

              {/* Connection config: domain / apiEndpoint */}
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

            <HStack gap={2}>
              {hasOAuth2Config &&
                integration.authMethod === 'oauth2' &&
                integration.oauth2Config?.clientId && (
                  <Button
                    variant="outline"
                    onClick={handleReauthorize}
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
                variant="outline"
                onClick={handleDisconnect}
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

            {/* Test result feedback */}
            {testResult && (
              <div
                className={cn(
                  'flex items-center gap-2 rounded-lg border p-3 text-sm',
                  testResult.success
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                    : 'border-destructive/30 bg-destructive/5 text-destructive',
                )}
                role="status"
              >
                {testResult.success ? (
                  <CheckCircle className="size-4 shrink-0" />
                ) : (
                  <XCircle className="size-4 shrink-0" />
                )}
                <span className="flex-1">{testResult.message}</span>
                <button
                  type="button"
                  onClick={() => setTestResult(null)}
                  className="hover:bg-foreground/5 shrink-0 rounded p-0.5"
                  aria-label={tCommon('aria.close')}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}
          </Stack>
        ) : (
          <>
            {/* SQL database settings */}
            {isSql && (
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
                  placeholder={
                    integration.sqlConnectionConfig?.server ?? '192.168.1.100'
                  }
                  value={sqlConfig['server'] ?? ''}
                  onChange={(e) =>
                    setSqlConfig((prev) => ({
                      ...prev,
                      server: e.target.value,
                    }))
                  }
                  disabled={busy}
                />
                <HStack gap={3}>
                  <Input
                    id="manage-sql-port"
                    label={t('integrations.manageDialog.port')}
                    type="number"
                    placeholder={String(
                      integration.sqlConnectionConfig?.port ?? 1433,
                    )}
                    value={sqlConfig['port'] ?? ''}
                    onChange={(e) =>
                      setSqlConfig((prev) => ({
                        ...prev,
                        port: e.target.value,
                      }))
                    }
                    disabled={busy}
                  />
                  <Input
                    id="manage-sql-database"
                    label={t('integrations.manageDialog.database')}
                    placeholder={
                      integration.sqlConnectionConfig?.database ?? ''
                    }
                    value={sqlConfig['database'] ?? ''}
                    onChange={(e) =>
                      setSqlConfig((prev) => ({
                        ...prev,
                        database: e.target.value,
                      }))
                    }
                    disabled={busy}
                  />
                </HStack>
              </Stack>
            )}

            {/* Authentication / Credentials */}
            <Stack gap={3} className="border-border rounded-lg border p-4">
              <div>
                <p className="text-sm font-medium">
                  {t('integrations.manageDialog.authentication')}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('integrations.upload.updateCredentialsHint')}
                </p>
              </div>

              {/* Auth method selector when multiple methods supported */}
              {hasMultipleAuthMethods && (
                <Select
                  id="manage-auth-method"
                  label={t('integrations.manageDialog.authenticationMethod')}
                  options={supportedMethods.map((m) => ({
                    value: m,
                    label: t(`integrations.authMethods.${m}`),
                  }))}
                  value={selectedAuthMethod}
                  onValueChange={(value: string) => {
                    const method = supportedMethods.find((m) => m === value);
                    if (method) {
                      setSelectedAuthMethod(method);
                      setCredentials({});
                      setTestResult(null);
                    }
                  }}
                  disabled={busy}
                />
              )}

              {/* SQL basic_auth has dedicated username/password fields */}
              {isSql && selectedAuthMethod === 'basic_auth' && (
                <>
                  <Input
                    id="manage-sql-username"
                    label={t('integrations.manageDialog.username')}
                    placeholder={integration.basicAuth?.username ?? ''}
                    value={credentials['username'] ?? ''}
                    onChange={(e) =>
                      setCredentials((prev) => ({
                        ...prev,
                        username: e.target.value,
                      }))
                    }
                    disabled={busy}
                  />
                  <Input
                    id="manage-sql-password"
                    label={t('integrations.manageDialog.password')}
                    type="password"
                    placeholder="••••••••"
                    value={credentials['password'] ?? ''}
                    onChange={(e) =>
                      setCredentials((prev) => ({
                        ...prev,
                        password: e.target.value,
                      }))
                    }
                    disabled={busy}
                  />
                </>
              )}

              {/* OAuth2: authorization flow when oauth2Config exists */}
              {selectedAuthMethod === 'oauth2' && hasOAuth2Config && (
                <>
                  <Input
                    id="manage-oauth2-authorization-url"
                    label={t('integrations.manageDialog.authorizationUrl')}
                    value={oauth2Fields.authorizationUrl}
                    onChange={(e) =>
                      setOAuth2Fields((prev) => ({
                        ...prev,
                        authorizationUrl: e.target.value,
                      }))
                    }
                    disabled={busy}
                  />
                  <Input
                    id="manage-oauth2-token-url"
                    label={t('integrations.manageDialog.tokenUrl')}
                    value={oauth2Fields.tokenUrl}
                    onChange={(e) =>
                      setOAuth2Fields((prev) => ({
                        ...prev,
                        tokenUrl: e.target.value,
                      }))
                    }
                    disabled={busy}
                  />
                  <Input
                    id="manage-oauth2-client-id"
                    label={t('integrations.manageDialog.clientId')}
                    value={oauth2Fields.clientId}
                    onChange={(e) =>
                      setOAuth2Fields((prev) => ({
                        ...prev,
                        clientId: e.target.value,
                      }))
                    }
                    disabled={busy}
                  />
                  <Input
                    id="manage-oauth2-client-secret"
                    label={t('integrations.manageDialog.clientSecret')}
                    type="password"
                    placeholder="••••••••"
                    value={oauth2Fields.clientSecret}
                    onChange={(e) =>
                      setOAuth2Fields((prev) => ({
                        ...prev,
                        clientSecret: e.target.value,
                      }))
                    }
                    disabled={busy}
                  />
                  <Button
                    onClick={handleSaveAndAuthorize}
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
                        <ExternalLink className="mr-2 size-4" />
                        {t('integrations.manageDialog.saveAndAuthorize')}
                      </>
                    )}
                  </Button>
                </>
              )}

              {/* OAuth2: manual token input as fallback when no oauth2Config */}
              {selectedAuthMethod === 'oauth2' && !hasOAuth2Config && (
                <>
                  <Input
                    id="manage-oauth2-access-token"
                    label={t('integrations.manageDialog.accessToken')}
                    type="password"
                    placeholder="••••••••"
                    value={credentials['accessToken'] ?? ''}
                    onChange={(e) =>
                      setCredentials((prev) => ({
                        ...prev,
                        accessToken: e.target.value,
                      }))
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
                      setCredentials((prev) => ({
                        ...prev,
                        refreshToken: e.target.value,
                      }))
                    }
                    disabled={busy}
                  />
                </>
              )}

              {/* Secret bindings (filtered for SQL basic_auth and oauth2 to avoid duplicates) */}
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
                    onChange={(e) =>
                      setCredentials((prev) => ({
                        ...prev,
                        [binding]: e.target.value,
                      }))
                    }
                    disabled={busy}
                  />
                );
              })}

              {/* Save and connect / Connect (hidden for OAuth2 auth flow) */}
              {!(selectedAuthMethod === 'oauth2' && hasOAuth2Config) && (
                <Button
                  onClick={handleTestConnection}
                  disabled={busy}
                  className="w-full"
                >
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

              {/* Test result feedback */}
              {testResult && (
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-lg border p-3 text-sm',
                    testResult.success
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'border-destructive/30 bg-destructive/5 text-destructive',
                  )}
                  role="status"
                >
                  {testResult.success ? (
                    <CheckCircle className="size-4 shrink-0" />
                  ) : (
                    <XCircle className="size-4 shrink-0" />
                  )}
                  <span className="flex-1">{testResult.message}</span>
                  <button
                    type="button"
                    onClick={() => setTestResult(null)}
                    className="hover:bg-foreground/5 shrink-0 rounded p-0.5"
                    aria-label={tCommon('aria.close')}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              )}
            </Stack>
          </>
        )}

        {/* Danger zone */}
        <Stack gap={3} className="border-border rounded-lg border p-4">
          <p className="text-muted-foreground text-xs">
            {t('integrations.manageDialog.deleteDescription')}
          </p>
          {confirmDelete ? (
            <HStack gap={2}>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={busy}
                className="flex-1"
              >
                <Trash2 className="mr-1 size-3.5" />
                {t('integrations.manageDialog.confirmDelete')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={busy}
                className="flex-1"
              >
                {t('integrations.manageDialog.cancelDelete')}
              </Button>
            </HStack>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
              className="text-destructive hover:text-destructive w-full"
            >
              <Trash2 className="mr-1 size-3.5" />
              {t('integrations.manageDialog.deleteIntegration')}
            </Button>
          )}
        </Stack>
      </Stack>
    </Dialog>
  );
}
