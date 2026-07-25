'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useAction } from 'convex/react';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';
import { fetchJson } from '@/lib/utils/type-utils';

import type { ParsedPackage } from '../components/integration-upload/utils/parse-integration-package';
import { parseIntegrationFiles } from '../components/integration-upload/utils/parse-integration-package';
import { ACCEPTED_ICON_TYPES, MAX_ICON_SIZE } from '../constants';
import {
  useGenerateIntegrationOAuth2Url,
  useSaveOAuth2Credentials,
  useTestIntegration,
} from './actions';
import { useGenerateUploadUrl, useUpdateCredentials } from './mutations';
import { buildSmtpAuthPatch } from './smtp-auth-payload';

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
  bearer_token: ['accessToken', 'token', 'key'],
  basic_auth: ['username', 'password'],
  oauth2: ['accessToken', 'refreshToken'],
};

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

export type Integration = Record<string, unknown> & {
  _id: string;
  title: string;
  name?: string;
  description?: string;
  organizationId?: string;
  authMethod?: string;
  supportedAuthMethods?: string[];
  isActive?: boolean;
  /** True for a user-created duplicate instance — fully deletable, not a builtin. */
  removable?: boolean;
  iconUrl?: string | null;
  oauth2Config?: {
    authorizationUrl?: string;
    tokenUrl?: string;
    clientId?: string;
    clientSecret?: string;
    // Slack-only; ciphertext, never displayed — only its presence is checked.
    signingSecretEncrypted?: string;
    scopes?: string[];
    [key: string]: unknown;
  };
  operations?: Array<{
    name: string;
    title?: string;
    description?: string;
    parametersSchema?: Record<string, unknown>;
    operationType?: string;
    requiresApproval?: boolean;
  }>;
  allowedHosts?: string[];
  connector?: {
    version?: number;
    code?: string;
    secretBindings?: string[];
    operations?: Array<{
      name: string;
      title?: string;
      description?: string;
      parametersSchema?: Record<string, unknown>;
      operationType?: string;
      requiresApproval?: boolean;
    }>;
    allowedHosts?: string[];
    [key: string]: unknown;
  };
  type?: string;
  sqlConnectionConfig?: {
    engine?: string;
    server?: string;
    port?: number;
    database?: string;
    readOnly?: boolean;
    options?: Record<string, unknown>;
    security?: {
      maxResultRows?: number;
      queryTimeoutMs?: number;
      maxConnectionPoolSize?: number;
    };
    [key: string]: unknown;
  };
  sqlOperations?: Array<{
    name: string;
    title?: string;
    description?: string;
    query: string;
    parametersSchema?: Record<string, unknown>;
    operationType?: string;
    requiresApproval?: boolean;
  }>;
  basicAuth?: { username?: string; password?: string; [key: string]: unknown };
  smtpAuth?: { username?: string; password?: string; [key: string]: unknown };
  apiKeyAuth?: { key?: string; [key: string]: unknown };
  oauth2Auth?: {
    accessToken?: string;
    refreshToken?: string;
    [key: string]: unknown;
  };
  connectionConfig?: {
    domain?: string;
    apiEndpoint?: string;
    [key: string]: unknown;
  };
};

export function useIntegrationManage(
  integration: Integration,
  onOpenChange: (open: boolean) => void,
  open: boolean,
  organizationId: string,
) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const queryClient = useQueryClient();

  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  // imap_smtp: whether sending uses a separate SMTP provider (its own login)
  // rather than the mailbox login. Synced to stored state below.
  const [smtpSeparate, setSmtpSeparate] = useState(false);
  // imap_smtp: whether the sender (From) address mirrors the mailbox username,
  // so the operator never enters their email twice. Off = a distinct sender
  // (e.g. a relay/Resend setup). Synced to stored state below.
  const [fromSameAsUsername, setFromSameAsUsername] = useState(true);
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
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

  // Whether a separate SMTP login is currently stored (imap_smtp only).
  const hasStoredSmtpAuth = !!integration.smtpAuth;
  // Reset the "separate SMTP provider" toggle to stored state whenever the
  // dialog (re)opens or the stored smtpAuth presence changes after a save.
  // Keyed on the presence boolean (not the object) so a refetch returning an
  // equivalent smtpAuth can't clobber the user's in-progress toggle.
  useEffect(() => {
    setSmtpSeparate(hasStoredSmtpAuth);
  }, [integration._id, hasStoredSmtpAuth, open]);

  // Stored sender identity (imap_smtp), as primitives so the reset effect below
  // depends on stable strings rather than the connectionConfig object.
  const rawStoredFrom = integration.connectionConfig?.fromAddress;
  const storedFromAddress =
    typeof rawStoredFrom === 'string' ? rawStoredFrom.trim() : '';
  const storedMailboxUsername = (integration.basicAuth?.username ?? '').trim();
  // Reset "send from my mailbox address" to stored state whenever the dialog
  // (re)opens: on when no distinct From is stored, or it equals the login.
  useEffect(() => {
    setFromSameAsUsername(
      storedFromAddress === '' || storedFromAddress === storedMailboxUsername,
    );
  }, [integration._id, storedFromAddress, storedMailboxUsername, open]);

  const { mutateAsync: updateCredentials } = useUpdateCredentials();
  const { mutateAsync: testConnection, isPending: isTesting } =
    useTestIntegration();
  const uninstallFn = useAction(
    api.integrations.file_actions.uninstallIntegration,
  );
  const deleteInstanceFn = useAction(
    api.integrations.file_actions.deleteIntegrationInstance,
  );
  const installFn = useAction(api.integrations.file_actions.installIntegration);
  const { mutateAsync: generateUploadUrl } = useGenerateUploadUrl();
  const { mutateAsync: generateOAuth2Url } = useGenerateIntegrationOAuth2Url();
  const { mutateAsync: saveOAuth2Credentials } = useSaveOAuth2Credentials();

  const [isSubmitting, setIsSubmitting] = useState(false);
  // Drives the DeleteDialog's loading state (via `busy`) so a delete/uninstall
  // shows "Deleting…" and holds the dialog open until it resolves — mirroring
  // the disconnect confirm, so a destructive action never looks like a no-op.
  const [isDeleting, setIsDeleting] = useState(false);

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
    // Slack-only: app signing secret. Never prefilled (it's a secret) — leaving
    // it blank on re-save preserves the stored value server-side.
    signingSecret: '',
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
      signingSecret: '',
      scopes: config?.scopes?.join(', ') ?? '',
    });
    setIsEditingOAuth2(false);
    setOAuth2SavedOptimistic(false);
  }, [integration._id, integration.oauth2Config]);

  const isSql = integration.type === 'sql';

  const secretBindings = useMemo(() => {
    if (integration.connector?.secretBindings) {
      return integration.connector.secretBindings;
    }
    const topLevel = integration.secretBindings;
    if (Array.isArray(topLevel)) return topLevel;
    return [];
  }, [integration.connector, integration.secretBindings]);

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

  const editableConfigFields = useMemo(() => {
    const config = integration.connectionConfig;
    if (!config || typeof config !== 'object') return [];
    const bindingSet = new Set(secretBindings);
    return Object.entries(config)
      .filter(([key]) => !bindingSet.has(key))
      .map(([key, value]) => ({
        key,
        type:
          typeof value === 'number' ? ('number' as const) : ('string' as const),
        defaultValue:
          typeof value === 'number'
            ? value
            : typeof value === 'string'
              ? value
              : '',
      }));
  }, [integration.connectionConfig, secretBindings]);

  const hasCredentialChanges = Object.values(credentials).some(
    (v) => v.trim().length > 0,
  );
  const hasConfigChanges = Object.values(configValues).some(
    (v) => v.trim().length > 0,
  );
  const hasSqlConfigChanges = Object.values(sqlConfig).some(
    (v) => v.trim().length > 0,
  );
  // Turning the "separate SMTP provider" toggle off while creds are stored is a
  // real change (drops them) even when no field was typed — Save/Test must fire.
  const smtpWillClear =
    integration.type === 'imap_smtp' && !smtpSeparate && hasStoredSmtpAuth;
  const hasChanges =
    hasCredentialChanges ||
    hasConfigChanges ||
    hasSqlConfigChanges ||
    smtpWillClear;

  // Toggle the "separate SMTP provider" fields. Turning it off reverts to the
  // mailbox login, so drop any typed SMTP credentials to keep state clean and
  // avoid stale values re-enabling Save.
  const handleSmtpSeparateChange = useCallback((value: boolean) => {
    setSmtpSeparate(value);
    if (!value) {
      setCredentials((prev) => {
        const next = { ...prev };
        delete next['smtpUsername'];
        delete next['smtpPassword'];
        return next;
      });
    }
  }, []);

  // Toggle "send from my mailbox address". When on, the From address mirrors
  // the login (set at save time), so drop any typed fromAddress to keep state
  // clean and avoid a stale value re-enabling Save.
  const handleFromSameAsUsernameChange = useCallback((value: boolean) => {
    setFromSameAsUsername(value);
    if (value) {
      setConfigValues((prev) => {
        const next = { ...prev };
        delete next['fromAddress'];
        return next;
      });
    }
  }, []);

  const busy =
    isSubmitting ||
    isTesting ||
    isSavingOAuth2 ||
    isApplyingUpdate ||
    isDeleting;

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

        const { storageId } = await fetchJson<{ storageId: string }>(
          uploadResponse,
        );

        await updateCredentials({
          credentialId: toId<'integrationCredentials'>(integration._id),
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
    [generateUploadUrl, updateCredentials, integration._id, t],
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
        credentialId: toId<'integrationCredentials'>(integration._id),
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
        const { storageId } = await fetchJson<{ storageId: string }>(
          uploadResponse,
        );
        await updateCredentials({
          credentialId: toId<'integrationCredentials'>(integration._id),
          iconStorageId: toId<'_storage'>(storageId),
        });
      }

      await updateCredentials(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Payload is dynamically built to match the mutation's expected shape
        payload as Parameters<typeof updateCredentials>[0],
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
  }, [parsedUpdate, integration, updateCredentials, generateUploadUrl, t]);

  const buildCredentialPayload = useCallback(() => {
    const authMethod = selectedAuthMethod;
    const payload: Record<string, unknown> = {};

    if (authMethod === 'api_key' || authMethod === 'bearer_token') {
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

    // imap_smtp: the "Use a separate SMTP provider" toggle decides whether to
    // set a distinct smtpAuth (e.g. Resend), clear a stored one (revert to the
    // mailbox login), or leave it untouched. See buildSmtpAuthPatch.
    if (integration.type === 'imap_smtp') {
      Object.assign(
        payload,
        buildSmtpAuthPatch({
          smtpSeparate,
          smtpUsername: credentials['smtpUsername'],
          smtpPassword: credentials['smtpPassword'],
          storedUsername: integration.smtpAuth?.username,
          hasStoredSmtpAuth,
        }),
      );
    }

    const connectionUpdates: Record<string, unknown> = {};
    const authHandledKeys = new Set(
      authMethod ? (AUTH_HANDLED_KEYS[authMethod] ?? []) : [],
    );
    for (const binding of secretBindings) {
      if (
        !SENSITIVE_KEYS.has(binding) &&
        !authHandledKeys.has(binding) &&
        credentials[binding]?.trim()
      ) {
        connectionUpdates[binding] = credentials[binding];
      }
    }
    for (const field of editableConfigFields) {
      const raw = configValues[field.key]?.trim();
      if (raw) {
        connectionUpdates[field.key] =
          field.type === 'number' ? Number(raw) : raw;
      }
    }
    // imap_smtp: when "send from my mailbox address" is on, the From address is
    // the mailbox login — mirror it so the operator never types their email
    // twice. A freshly typed username wins over the stored one.
    if (integration.type === 'imap_smtp' && fromSameAsUsername) {
      const mailbox =
        credentials['username']?.trim() ||
        integration.basicAuth?.username?.trim();
      if (mailbox) connectionUpdates['fromAddress'] = mailbox;
    }
    if (Object.keys(connectionUpdates).length > 0) {
      payload.connectionConfig = {
        ...integration.connectionConfig,
        ...connectionUpdates,
      };
    }

    return payload;
  }, [
    credentials,
    configValues,
    selectedAuthMethod,
    integration,
    secretBindings,
    editableConfigFields,
    smtpSeparate,
    hasStoredSmtpAuth,
    fromSameAsUsername,
  ]);

  const buildSqlConnectionPayload = useCallback(() => {
    const existing = integration.sqlConnectionConfig;
    return {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- engine value comes from existing config with known runtime shape
      engine: (existing?.engine ?? 'mssql') as 'mssql' | 'postgres' | 'mysql',
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
      credentialId: toId<'integrationCredentials'>(integration._id),
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
      // If no credential record exists yet (uninstalled integration), install first
      let credentialId = integration._id;
      const slug = integration.name ?? '';
      if (credentialId === slug && slug && integration.organizationId) {
        const installResult = await installFn({
          slug,
          organizationId,
        });
        credentialId = installResult.credentialId;
      }

      const testArgs: Parameters<typeof testConnection>[0] = {
        credentialId: toId<'integrationCredentials'>(credentialId),
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
        // Use the resolved credential ID for the update
        updateArgs.credentialId = toId<'integrationCredentials'>(credentialId);
        await updateCredentials(
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Payload is dynamically built to match the mutation's expected shape
          updateArgs as Parameters<typeof updateCredentials>[0],
        );
        setOptimisticActive(true);
        setCredentials({});
        setConfigValues({});
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
    organizationId,
    buildCredentialPayload,
    buildSqlConnectionPayload,
    buildUpdateArgs,
    updateCredentials,
    testConnection,
    installFn,
    t,
  ]);

  const handleDisconnect = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await updateCredentials({
        credentialId: toId<'integrationCredentials'>(integration._id),
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
      setConfigValues({});
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
  }, [updateCredentials, integration, t]);

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
      // If no credential record exists yet (uninstalled integration), install first
      let credentialId = integration._id;
      const slug = integration.name ?? '';
      if (credentialId === slug && slug && integration.organizationId) {
        const installResult = await installFn({
          slug,
          organizationId,
        });
        credentialId = installResult.credentialId;
      }

      const parsedScopes = oauth2Fields.scopes
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      await saveOAuth2Credentials({
        credentialId: toId<'integrationCredentials'>(credentialId),
        authorizationUrl: oauth2Fields.authorizationUrl.trim(),
        tokenUrl: oauth2Fields.tokenUrl.trim(),
        scopes: parsedScopes.length > 0 ? parsedScopes : undefined,
        clientId: oauth2Fields.clientId.trim(),
        clientSecret: oauth2Fields.clientSecret.trim(),
        // Slack-only; blank means "keep the stored signing secret" server-side.
        signingSecret: oauth2Fields.signingSecret.trim() || undefined,
      });

      setOAuth2Fields((prev) => ({
        ...prev,
        clientSecret: '',
        signingSecret: '',
      }));
      setIsEditingOAuth2(false);
      setOAuth2SavedOptimistic(true);

      toast({
        title: t('integrations.manageDialog.credentialsSaved'),
        variant: 'success',
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
  }, [
    oauth2Fields,
    integration._id,
    integration.name,
    integration.organizationId,
    organizationId,
    saveOAuth2Credentials,
    installFn,
    t,
  ]);

  // Ensure the credential stub exists, then build the provider authorization
  // URL — WITHOUT navigating. The settings page redirects the whole tab to it
  // (`handleReauthorize`); the install wizard opens it in a popup so the inline
  // multi-step flow isn't torn down. One source of truth for the URL.
  const prepareOAuth2Url = useCallback(async (): Promise<string | null> => {
    // If no credential record exists yet (uninstalled integration), install first
    let credentialId = integration._id;
    const slug = integration.name ?? '';
    if (credentialId === slug && slug && integration.organizationId) {
      const installResult = await installFn({
        slug,
        organizationId,
      });
      credentialId = installResult.credentialId;
    }

    return generateOAuth2Url({
      credentialId: toId<'integrationCredentials'>(credentialId),
      organizationId: integration.organizationId ?? '',
    });
  }, [
    integration._id,
    integration.name,
    integration.organizationId,
    organizationId,
    generateOAuth2Url,
    installFn,
  ]);

  const handleReauthorize = useCallback(async () => {
    setIsSavingOAuth2(true);
    try {
      const authUrl = await prepareOAuth2Url();
      if (authUrl) window.location.href = authUrl;
    } catch (error) {
      toast({
        title: t('integrations.manageDialog.oauth2AuthorizationFailed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
      setIsSavingOAuth2(false);
    }
  }, [prepareOAuth2Url, t]);

  const oauth2FieldsComplete =
    oauth2Fields.clientId.trim().length > 0 &&
    oauth2Fields.clientSecret.trim().length > 0;

  const hasOAuth2Credentials =
    !!integration.oauth2Config?.clientId || oauth2SavedOptimistic;

  const handleUninstall = useCallback(async () => {
    setIsDeleting(true);
    try {
      await uninstallFn({
        slug: integration.name ?? '',
        organizationId,
      });
      void queryClient.invalidateQueries({
        queryKey: ['config', 'integrations'],
      });
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
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  }, [uninstallFn, integration, organizationId, onOpenChange, t, queryClient]);

  // Fully delete a user-created duplicate instance (config dir + credential +
  // rebound automations) — unlike `handleUninstall`, which only removes the
  // credential. Available while the instance is disconnected.
  const isRemovable = integration.removable === true;
  const handleDeleteInstance = useCallback(async () => {
    setIsDeleting(true);
    try {
      await deleteInstanceFn({
        slug: integration.name ?? '',
        organizationId,
      });
      void queryClient.invalidateQueries({
        queryKey: ['config', 'integrations'],
      });
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
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  }, [
    deleteInstanceFn,
    integration,
    organizationId,
    onOpenChange,
    t,
    queryClient,
  ]);

  const operationCount =
    (integration.connector?.operations?.length ??
      integration.operations?.length ??
      0) + (integration.sqlOperations?.length ?? 0);

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
    prepareOAuth2Url,

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
    editableConfigFields,
    configValues,
    setConfigValues,
    credentials,
    setCredentials,
    smtpSeparate,
    handleSmtpSeparateChange,
    fromSameAsUsername,
    handleFromSameAsUsernameChange,
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
    handleUninstall,
    isRemovable,
    handleDeleteInstance,

    maskValue,
  };
}

export { SENSITIVE_KEYS, maskValue };
