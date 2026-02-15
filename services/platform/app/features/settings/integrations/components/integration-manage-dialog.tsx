'use client';

import {
  AlertCircle,
  CheckCircle,
  ChevronRight,
  Code,
  ExternalLink,
  XCircle,
  Loader2,
  Pencil,
  Puzzle,
  Save,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

import type { Doc } from '@/convex/_generated/dataModel';

import { Image } from '@/app/components/ui/data-display/image';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Badge } from '@/app/components/ui/feedback/badge';
import { StatusIndicator } from '@/app/components/ui/feedback/status-indicator';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Center, Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { toast } from '@/app/hooks/use-toast';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { ParsedPackage } from './integration-upload/utils/parse-integration-package';

import {
  useGenerateIntegrationOAuth2Url,
  useSaveOAuth2Credentials,
  useTestIntegration,
  useUpdateIntegration,
} from '../hooks/actions';
import {
  useDeleteIntegration,
  useGenerateUploadUrl,
  useUpdateIntegrationIcon,
} from '../hooks/mutations';
import { IntegrationDetails } from './integration-details';
import { parseIntegrationFiles } from './integration-upload/utils/parse-integration-package';

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

function parsePort(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

const MAX_ICON_SIZE = 256 * 1024; // 256KB
const ACCEPTED_ICON_TYPES = new Set([
  'image/png',
  'image/svg+xml',
  'image/jpeg',
  'image/webp',
]);

function TestResultFeedback({
  result,
  onDismiss,
  closeLabel,
}: {
  result: { success: boolean; message: string };
  onDismiss: () => void;
  closeLabel: string;
}) {
  return (
    <output
      className={cn(
        'flex items-center gap-2 rounded-lg border p-3 text-sm',
        result.success
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
          : 'border-destructive/30 bg-destructive/5 text-destructive',
      )}
      aria-live="polite"
    >
      {result.success ? (
        <CheckCircle className="size-4 shrink-0" />
      ) : (
        <XCircle className="size-4 shrink-0" />
      )}
      <span className="flex-1">{result.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="hover:bg-foreground/5 shrink-0 rounded p-0.5"
        aria-label={closeLabel}
      >
        <X className="size-3.5" />
      </button>
    </output>
  );
}

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

  // Update integration package state
  const [parsedUpdate, setParsedUpdate] = useState<ParsedPackage | null>(null);
  const [isParsingUpdate, setIsParsingUpdate] = useState(false);
  const [updateParseError, setUpdateParseError] = useState<string | null>(null);
  const [isApplyingUpdate, setIsApplyingUpdate] = useState(false);

  // Clear optimistic overrides when Convex reactive query updates the real data
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

  // Reset update state when dialog reopens or integration changes
  useEffect(() => {
    if (!open) return;
    setParsedUpdate(null);
    setUpdateParseError(null);
    setIsParsingUpdate(false);
    setIsApplyingUpdate(false);
  }, [open, integration._id]);

  // OAuth2 client credential state (for authorization flow)
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

  // Pre-fill OAuth2 fields from integration config (reset fully on integration change)
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

  const busy = isSubmitting || isTesting || isSavingOAuth2 || isApplyingUpdate;

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

      // Upload icon if present in the update package
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

        {/* Operations, connector details & update */}
        <IntegrationDetails integration={integration}>
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium select-none">
              <ChevronRight className="text-muted-foreground size-3.5 shrink-0 transition-transform duration-200 group-open:rotate-90" />
              <Upload className="size-4 shrink-0" />
              <span>{t('integrations.manageDialog.updateIntegration')}</span>
            </summary>
            <Stack gap={3} className="mt-2 ml-6">
              <p className="text-muted-foreground text-xs">
                {t('integrations.manageDialog.updateIntegrationDescription')}
              </p>

              <FileUpload.Root>
                <FileUpload.DropZone
                  onFilesSelected={handleUpdateFilesSelected}
                  accept=".zip,.json,.js,.png,.svg,.jpg,.jpeg,.webp"
                  multiple
                  disabled={isParsingUpdate || isApplyingUpdate}
                  inputId="integration-update-upload"
                  aria-label={t('integrations.manageDialog.updateIntegration')}
                  className={cn(
                    'border-border hover:border-primary/50 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 transition-colors',
                    (isParsingUpdate || isApplyingUpdate) &&
                      'pointer-events-none opacity-50',
                  )}
                >
                  <Upload className="text-muted-foreground size-5" />
                  <Stack gap={1} className="text-center">
                    <p className="text-xs font-medium">
                      {isParsingUpdate
                        ? t('integrations.upload.parsing')
                        : t('integrations.manageDialog.dropFilesToUpdate')}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t('integrations.manageDialog.acceptedUpdateFormats')}
                    </p>
                  </Stack>
                </FileUpload.DropZone>
                <FileUpload.Overlay label={t('integrations.upload.dropHere')} />
              </FileUpload.Root>

              {updateParseError && (
                <div
                  className="bg-destructive/10 text-destructive flex items-start gap-2 rounded-md p-3 text-sm"
                  role="alert"
                >
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <pre className="font-sans whitespace-pre-wrap">
                    {updateParseError}
                  </pre>
                </div>
              )}

              {parsedUpdate && (
                <Stack gap={3}>
                  <Stack gap={2} className="bg-muted/50 rounded-lg p-3">
                    <p className="text-xs font-medium">
                      {t('integrations.manageDialog.updatePreview')}
                    </p>
                    <HStack gap={3} className="text-muted-foreground text-xs">
                      <HStack gap={1} className="items-center">
                        <Zap className="size-3" />
                        <span>
                          {t('integrations.manageDialog.newOperations', {
                            count: parsedUpdate.config.operations.length,
                          })}
                        </span>
                      </HStack>
                      {parsedUpdate.connectorCode.trim().length > 0 && (
                        <HStack gap={1} className="items-center">
                          <Code className="size-3" />
                          <span>
                            {t('integrations.manageDialog.newCodeLines', {
                              count: parsedUpdate.connectorCode
                                .trim()
                                .split('\n').length,
                            })}
                          </span>
                        </HStack>
                      )}
                    </HStack>
                  </Stack>

                  <HStack gap={2}>
                    <Button
                      onClick={handleApplyUpdate}
                      disabled={busy}
                      size="sm"
                      className="flex-1"
                    >
                      {isApplyingUpdate ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" />
                          {t('integrations.manageDialog.applyingUpdate')}
                        </>
                      ) : (
                        t('integrations.manageDialog.applyUpdate')
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setParsedUpdate(null);
                        setUpdateParseError(null);
                      }}
                      disabled={busy}
                    >
                      {tCommon('actions.cancel')}
                    </Button>
                  </HStack>
                </Stack>
              )}
            </Stack>
          </details>
        </IntegrationDetails>

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

            <Button
              variant="outline"
              onClick={handleTestConnection}
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
              <TestResultFeedback
                result={testResult}
                onDismiss={() => setTestResult(null)}
                closeLabel={tCommon('aria.close')}
              />
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
              {selectedAuthMethod === 'oauth2' &&
                hasOAuth2Config &&
                (hasOAuth2Credentials && !isEditingOAuth2 ? (
                  <>
                    <Stack gap={2}>
                      <HStack
                        gap={2}
                        className="text-muted-foreground items-center text-sm"
                      >
                        <span className="w-20 shrink-0 text-xs">
                          {t('integrations.manageDialog.clientId')}
                        </span>
                        <span className="truncate font-mono text-xs">
                          {maskValue(integration.oauth2Config?.clientId ?? '')}
                        </span>
                      </HStack>
                      <HStack
                        gap={2}
                        className="text-muted-foreground items-center text-sm"
                      >
                        <span className="w-20 shrink-0 text-xs">
                          {t('integrations.manageDialog.clientSecret')}
                        </span>
                        <span className="font-mono text-xs">
                          {'×'.repeat(8)}
                        </span>
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
                    <Button
                      onClick={handleReauthorize}
                      disabled={busy}
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
                          {t('integrations.authorize')}
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditingOAuth2(true)}
                      disabled={busy}
                      className="w-full"
                    >
                      <Pencil className="mr-2 size-3.5" />
                      {t('integrations.manageDialog.updateCredentials')}
                    </Button>
                  </>
                ) : (
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
                    <Textarea
                      id="manage-oauth2-scopes"
                      label={t('integrations.manageDialog.scopes')}
                      placeholder="channels:read, channels:history"
                      rows={3}
                      value={oauth2Fields.scopes}
                      onChange={(e) =>
                        setOAuth2Fields((prev) => ({
                          ...prev,
                          scopes: e.target.value,
                        }))
                      }
                      disabled={busy}
                    />
                    <Button
                      onClick={handleSaveOAuth2Only}
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
                        variant="outline"
                        size="sm"
                        onClick={() => setIsEditingOAuth2(false)}
                        disabled={busy}
                        className="w-full"
                      >
                        {tCommon('actions.cancel')}
                      </Button>
                    )}
                  </>
                ))}

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
                <TestResultFeedback
                  result={testResult}
                  onDismiss={() => setTestResult(null)}
                  closeLabel={tCommon('aria.close')}
                />
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
