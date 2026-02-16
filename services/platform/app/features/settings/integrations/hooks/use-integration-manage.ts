'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import type { ParsedPackage } from '../components/integration-upload/utils/parse-integration-package';

import { parseIntegrationFiles } from '../components/integration-upload/utils/parse-integration-package';
import {
  useGenerateIntegrationOAuth2Url,
  useSaveOAuth2Credentials,
  useTestIntegration,
  useUpdateIntegration,
} from './actions';
import {
  useDeleteIntegration,
  useGenerateUploadUrl,
  useUpdateIntegrationIcon,
} from './mutations';

const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'accessToken',
  'apiKey',
  'key',
  'refreshToken',
]);

const AUTH_HANDLED_KEYS: Record<string, string[]> = {
  api_key: [],
  bearer_token: [],
  basic_auth: ['username', 'password'],
  oauth2: ['accessToken', 'refreshToken'],
};

const MAX_ICON_SIZE = 256 * 1024;
const ACCEPTED_ICON_TYPES = new Set([
  'image/png',
  'image/svg+xml',
  'image/jpeg',
  'image/webp',
]);

function maskValue(value: string, visibleChars = 6): string {
  if (value.length <= visibleChars) return '\u00d7'.repeat(8);
  return value.slice(0, visibleChars) + '\u00d7'.repeat(7);
}

function parsePort(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

type Integration = Doc<'integrations'> & { iconUrl?: string | null };

export function useIntegrationManage(
  integration: Integration,
  onOpenChange: (open: boolean) => void,
  open: boolean,
) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');

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

  const [parsedUpdate, setParsedUpdate] = useState<ParsedPackage | null>(null);
  const [isParsingUpdate, setIsParsingUpdate] = useState(false);
  const [updateParseError, setUpdateParseError] = useState<string | null>(null);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);

  useEffect(() => {
    setOptimisticActive(null);
  }, [integration.isActive]);

  useEffect(() => {
    if (optimisticIconUrl && integration.iconUrl) {
      URL.revokeObjectURL(optimisticIconUrl);
      setOptimisticIconUrl(null);
    }
  }, [integration.iconUrl, optimisticIconUrl]);

  useEffect(() => {
    return () => {
      if (optimisticIconUrl) {
        URL.revokeObjectURL(optimisticIconUrl);
      }
    };
  }, [optimisticIconUrl]);

  const isActive = optimisticActive ?? integration.isActive;
  const iconUrl = optimisticIconUrl ?? integration.iconUrl;

  const { mutateAsync: updateIntegration, isPending: isUpdating } =
    useUpdateIntegration();
  const { mutateAsync: testConnection, isPending: isTesting } =
    useTestIntegration();
  const { mutateAsync: deleteIntegration, isPending: isDeleting } =
    useDeleteIntegration();
  const { mutateAsync: generateUploadUrl } = useGenerateUploadUrl();
  const { mutateAsync: updateIcon } = useUpdateIntegrationIcon();
  const { mutateAsync: generateOAuth2Url } = useGenerateIntegrationOAuth2Url();
  const { mutateAsync: saveOAuth2Credentials } = useSaveOAuth2Credentials();

  const isSubmitting = isUpdating || isDeleting;

  const hasOAuth2Config = !!integration.oauth2Config;

  const supportedMethods = useMemo(
    () => integration.supportedAuthMethods ?? [integration.authMethod],
    [integration.supportedAuthMethods, integration.authMethod],
  );
  const hasMultipleAuthMethods = supportedMethods.length > 1;
  const [selectedAuthMethod, setSelectedAuthMethod] = useState(
    integration.authMethod,
  );

  useEffect(() => {
    setSelectedAuthMethod(integration.authMethod);
  }, [integration.authMethod]);

  useEffect(() => {
    if (!open) return;
    setParsedUpdate(null);
    setUpdateParseError(null);
    setIsParsingUpdate(false);
    setIsApplyingUpdate(false);
  }, [open, integration._id]);

  const [oauth2Fields, setOAuth2Fields] = useState({
    authorizationUrl: '',
    tokenUrl: '',
    clientId: '',
    clientSecret: '',
    scopes: '',
  });
  const [isSavingOAuth2, setIsSavingOAuth2] = useState(false);
  const [isEditingOAuth2, setIsEditingOAuth2] = useState(false);
  const [oauth2SavedOptimistic, setOAuth2SavedOptimistic] = useState(false);

  useEffect(() => {
    const config = integration.oauth2Config;
    setOAuth2Fields({
      authorizationUrl: config?.authorizationUrl ?? '',
      tokenUrl: config?.tokenUrl ?? '',
      clientId: config?.clientId ?? '',
      clientSecret: '',
      scopes: config?.scopes?.join(', ') ?? '',
    });
    setIsEditingOAuth2(false);
    setOAuth2SavedOptimistic(false);
  }, [integration._id, integration.oauth2Config]);

  const isSql = integration.type === 'sql';

  const secretBindings = useMemo(
    () => integration.connector?.secretBindings ?? [],
    [integration.connector],
  );

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

  const busy = isSubmitting || isTesting || isSavingOAuth2 || isApplyingUpdate;

  const busyRef = useRef(false);
  busyRef.current = busy;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen || !busyRef.current) {
      onOpenChangeRef.current(nextOpen);
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
        const uploadUrl = await generateUploadUrl({});
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
      } catch (error) {
        URL.revokeObjectURL(previewUrl);
        toast({
          title: t('integrations.updateFailed'),
          variant: 'destructive',
          description: error instanceof Error ? error.message : undefined,
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

  const handleUpdateFilesSelected = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      setUpdateParseError(null);
      setIsParsingUpdate(true);
      setParsedUpdate(null);

      try {
        const result = await parseIntegrationFiles(files);
        if (result.success && result.data) {
          setParsedUpdate(result.data);
        } else {
          setUpdateParseError(
            result.error ?? t('integrations.upload.parseError'),
          );
        }
      } catch {
        setUpdateParseError(t('integrations.upload.unexpectedError'));
      } finally {
        setIsParsingUpdate(false);
      }
    },
    [t],
  );

  const handleApplyUpdate = useCallback(async () => {
    if (!parsedUpdate) return;

    setIsApplyingUpdate(true);

    try {
      const { config, connectorCode } = parsedUpdate;
      const packageType = config.type ?? 'rest_api';
      const integType = integration.type ?? 'rest_api';
      if (packageType !== integType) {
        toast({
          title: t('integrations.manageDialog.updateFailed'),
          description: t('integrations.manageDialog.updateTypeMismatch'),
          variant: 'destructive',
        });
        setIsApplyingUpdate(false);
        return;
      }
      const isSqlUpdate = config.type === 'sql';
      const authMethod =
        config.authMethod === 'bearer_token' ? 'api_key' : config.authMethod;
      const supportedAuthMethods = config.supportedAuthMethods?.map(
        (m: string) => (m === 'bearer_token' ? 'api_key' : m),
      );

      const connector =
        !isSqlUpdate && connectorCode.trim().length > 0
          ? {
              code: connectorCode,
              version: (integration.connector?.version ?? 0) + 1,
              operations: config.operations.map((op) => ({
                name: op.name,
                title: op.title,
                description: op.description,
                parametersSchema: op.parametersSchema,
                operationType: op.operationType,
                requiresApproval: op.requiresApproval,
              })),
              secretBindings: config.secretBindings,
              allowedHosts: config.allowedHosts,
              timeoutMs: config.connectionConfig?.timeout,
            }
          : undefined;

      const payload: Record<string, unknown> = {
        integrationId: integration._id,
        title: config.title,
        description: config.description,
        authMethod,
        supportedAuthMethods,
        connector,
      };

      if (isSqlUpdate && config.sqlConnectionConfig) {
        payload.sqlConnectionConfig = config.sqlConnectionConfig;
      }

      if (isSqlUpdate) {
        const sqlOps = config.operations
          .filter((op) => op.query)
          .map((op) => ({
            name: op.name,
            title: op.title,
            description: op.description,
            query: op.query,
            parametersSchema: op.parametersSchema,
            operationType: op.operationType,
            requiresApproval: op.requiresApproval,
          }));
        if (sqlOps.length > 0) {
          payload.sqlOperations = sqlOps;
        }
      }

      if (parsedUpdate.iconFile) {
        const uploadUrl = await generateUploadUrl({});
        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Content-Type': parsedUpdate.iconFile.type || 'image/png',
          },
          body: parsedUpdate.iconFile,
        });
        if (!uploadResponse.ok) {
          throw new Error(t('integrations.updateFailed'));
        }
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fetch response.json() returns unknown
        const { storageId } = (await uploadResponse.json()) as {
          storageId: string;
        };
        await updateIcon({
          integrationId: integration._id,
          iconStorageId: toId<'_storage'>(storageId),
        });
      }

      await updateIntegration(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- dynamic payload
        payload as Parameters<typeof updateIntegration>[0],
      );

      toast({
        title: t('integrations.manageDialog.updateSuccess'),
        description: t('integrations.manageDialog.updateSuccessDescription'),
        variant: 'success',
      });
      setParsedUpdate(null);
      setUpdateParseError(null);
    } catch (error) {
      toast({
        title: t('integrations.manageDialog.updateFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsApplyingUpdate(false);
    }
  }, [
    parsedUpdate,
    integration,
    updateIntegration,
    generateUploadUrl,
    updateIcon,
    t,
  ]);

  const buildCredentialPayload = useCallback(() => {
    const authMethod = selectedAuthMethod;
    const payload: Record<string, unknown> = {};

    if (authMethod === 'api_key') {
      const keyBinding = secretBindings.find((b) => SENSITIVE_KEYS.has(b));
      const keyValue = credentials[keyBinding ?? secretBindings[0]];
      if (keyValue?.trim()) {
        payload.apiKeyAuth = { key: keyValue };
      }
    } else if (authMethod === 'basic_auth') {
      if (credentials['username']?.trim() || credentials['password']?.trim()) {
        payload.basicAuth = {
          username:
            credentials['username']?.trim() ||
            integration.basicAuth?.username ||
            '',
          password: credentials['password']?.trim() || '',
        };
      }
    } else if (authMethod === 'oauth2') {
      if (credentials['accessToken']?.trim()) {
        payload.oauth2Auth = {
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
      payload.connectionConfig = {
        ...integration.connectionConfig,
        ...connectionUpdates,
      };
    }

    return payload;
  }, [credentials, selectedAuthMethod, integration, secretBindings]);

  const buildSqlConnectionPayload = useCallback(() => {
    const existing = integration.sqlConnectionConfig;
    return {
      engine: existing?.engine ?? 'mssql',
      server: sqlConfig['server']?.trim() || existing?.server,
      port: parsePort(sqlConfig['port']) ?? existing?.port,
      database: sqlConfig['database']?.trim() || existing?.database,
      readOnly: existing?.readOnly,
      options: existing?.options,
      security: existing?.security,
    };
  }, [sqlConfig, integration.sqlConnectionConfig]);

  const buildUpdateArgs = useCallback(() => {
    const updateArgs: Record<string, unknown> = {
      integrationId: integration._id,
      isActive: true,
      status: 'active',
      ...buildCredentialPayload(),
    };

    if (selectedAuthMethod !== integration.authMethod) {
      updateArgs.authMethod = selectedAuthMethod;
    }

    if (isSql && hasSqlConfigChanges) {
      updateArgs.sqlConnectionConfig = buildSqlConnectionPayload();
    }

    return updateArgs;
  }, [
    isSql,
    hasSqlConfigChanges,
    selectedAuthMethod,
    integration,
    buildCredentialPayload,
    buildSqlConnectionPayload,
  ]);

  const handleTestConnection = useCallback(async () => {
    setTestResult(null);

    try {
      const testArgs: Parameters<typeof testConnection>[0] = {
        integrationId: integration._id,
      };

      if (hasChanges) {
        Object.assign(testArgs, buildCredentialPayload());

        if (isSql && hasSqlConfigChanges) {
          testArgs.sqlConnectionConfig = buildSqlConnectionPayload();
        }
      }

      const result = await testConnection(testArgs);

      if (result.success && hasChanges) {
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
    } catch (error) {
      setTestResult({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : t('integrations.failedToTestConnection'),
      });
    }
  }, [
    isSql,
    hasChanges,
    hasSqlConfigChanges,
    integration,
    buildCredentialPayload,
    buildSqlConnectionPayload,
    buildUpdateArgs,
    updateIntegration,
    testConnection,
    t,
  ]);

  const handleDisconnect = useCallback(async () => {
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
    }
  }, [updateIntegration, integration, t]);

  const handleSaveOAuth2Only = useCallback(async () => {
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
      const parsedScopes = oauth2Fields.scopes
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      await saveOAuth2Credentials({
        integrationId: integration._id,
        authorizationUrl: oauth2Fields.authorizationUrl.trim(),
        tokenUrl: oauth2Fields.tokenUrl.trim(),
        scopes: parsedScopes.length > 0 ? parsedScopes : undefined,
        clientId: oauth2Fields.clientId.trim(),
        clientSecret: oauth2Fields.clientSecret.trim(),
      });

      setOAuth2Fields((prev) => ({ ...prev, clientSecret: '' }));
      setIsEditingOAuth2(false);
      setOAuth2SavedOptimistic(true);

      toast({
        title: t('integrations.manageDialog.credentialsSaved'),
      });
    } catch (error) {
      toast({
        title: t('integrations.manageDialog.credentialsSaveFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsSavingOAuth2(false);
    }
  }, [oauth2Fields, integration._id, saveOAuth2Credentials, t]);

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

  const hasOAuth2Credentials =
    !!integration.oauth2Config?.clientId || oauth2SavedOptimistic;

  const handleDelete = useCallback(async () => {
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
      setConfirmDelete(false);
    }
  }, [deleteIntegration, integration, onOpenChange, t]);

  const operationCount =
    (integration.connector?.operations?.length ?? 0) +
    (integration.sqlOperations?.length ?? 0);

  return {
    t,
    tCommon,
    isActive,
    iconUrl,
    isSql,
    busy,
    isSubmitting,
    isTesting,
    isSavingOAuth2,
    isUploadingIcon,
    iconInputRef,
    operationCount,
    handleOpenChange,
    handleIconUpload,

    testResult,
    setTestResult,
    handleTestConnection,
    handleDisconnect,
    handleReauthorize,

    hasOAuth2Config,
    hasOAuth2Credentials,
    oauth2Fields,
    setOAuth2Fields,
    oauth2FieldsComplete,
    isEditingOAuth2,
    setIsEditingOAuth2,
    handleSaveOAuth2Only,

    selectedAuthMethod,
    setSelectedAuthMethod,
    supportedMethods,
    hasMultipleAuthMethods,
    secretBindings,
    displayBindings,
    credentials,
    setCredentials,
    hasChanges,

    sqlConfig,
    setSqlConfig,

    parsedUpdate,
    setParsedUpdate,
    isParsingUpdate,
    isApplyingUpdate,
    updateParseError,
    setUpdateParseError,
    handleUpdateFilesSelected,
    handleApplyUpdate,

    confirmDelete,
    setConfirmDelete,
    handleDelete,

    maskValue,
  };
}

export { SENSITIVE_KEYS, maskValue };
