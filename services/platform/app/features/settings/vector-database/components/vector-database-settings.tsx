'use client';

import { Button } from '@tale/ui/button';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Banner } from '@/app/components/ui/feedback/banner';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Form } from '@/app/components/ui/forms/form';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { readConvexErrorData } from '@/app/features/settings/providers/utils/error-dispatch';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import type { VectorDbConfig } from '@/lib/shared/schemas/vectordb';

import {
  useSaveVectorDbConfig,
  useSaveVectorDbSecret,
  useTestVectorDbConnection,
} from '../hooks/mutations';
import { useReadVectorDbConfig } from '../hooks/queries';

type Backend = 'pgvector' | 'pgvector_external' | 'qdrant';
type BackendType = 'builtin' | 'external';
type ExternalBackend = 'qdrant' | 'pgvector_external';
type SslMode = 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';

const SSL_MODES: SslMode[] = [
  'disable',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
];

function isSslMode(value: string): value is SslMode {
  return (SSL_MODES as readonly string[]).includes(value);
}

interface VectorDbFormData {
  backend: Backend;
  // Qdrant
  qdrantUrl: string;
  collection: string;
  preferGrpc: boolean;
  /** Write-only — empty means "leave the stored key unchanged". */
  apiKey: string;
  // External pgvector
  pgHost: string;
  pgPort: number;
  pgDatabase: string;
  pgUser: string;
  pgSslmode: SslMode;
  pgTable: string;
  /** Write-only — empty means "leave the stored password unchanged". */
  password: string;
}

function toConfig(data: VectorDbFormData): VectorDbConfig {
  if (data.backend === 'pgvector') return { backend: 'pgvector' };
  if (data.backend === 'pgvector_external') {
    return {
      backend: 'pgvector_external',
      pgvectorExternal: {
        host: data.pgHost.trim(),
        port: Number.isFinite(data.pgPort) ? data.pgPort : 5432,
        database: data.pgDatabase.trim(),
        user: data.pgUser.trim(),
        sslmode: data.pgSslmode,
        table: data.pgTable.trim() || 'tale_vectors',
      },
    };
  }
  return {
    backend: 'qdrant',
    qdrant: {
      url: data.qdrantUrl.trim(),
      collection: data.collection.trim() || 'tale_chunks',
      preferGrpc: data.preferGrpc,
    },
  };
}

function configToForm(config: VectorDbConfig): VectorDbFormData {
  const base: VectorDbFormData = {
    backend: config.backend,
    qdrantUrl: '',
    collection: 'tale_chunks',
    preferGrpc: false,
    apiKey: '',
    pgHost: '',
    pgPort: 5432,
    pgDatabase: '',
    pgUser: '',
    pgSslmode: 'require',
    pgTable: 'tale_vectors',
    password: '',
  };
  if (config.backend === 'qdrant') {
    return {
      ...base,
      qdrantUrl: config.qdrant.url,
      collection: config.qdrant.collection,
      preferGrpc: config.qdrant.preferGrpc ?? false,
    };
  }
  if (config.backend === 'pgvector_external') {
    const p = config.pgvectorExternal;
    return {
      ...base,
      pgHost: p.host,
      pgPort: p.port,
      pgDatabase: p.database,
      pgUser: p.user,
      pgSslmode: p.sslmode,
      pgTable: p.table,
    };
  }
  return base;
}

// =============================================================================
// Container — access check + data load; wraps the form in <Skeletonize>.
// =============================================================================
export function VectorDatabaseSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const { data, isLoading } = useReadVectorDbConfig(organizationId, {
    enabled: !abilityLoading && ability.can('read', 'orgSettings'),
  });

  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('organization')} />;
  }

  return (
    <Skeletonize loading={abilityLoading || isLoading}>
      <VectorDatabaseForm
        organizationId={organizationId}
        initialConfig={data?.config ?? { backend: 'pgvector' }}
        hash={data?.hash ?? null}
        hasApiKey={data?.hasApiKey ?? false}
        maskedApiKey={data?.maskedApiKey ?? null}
        hasPassword={data?.hasPassword ?? false}
        maskedPassword={data?.maskedPassword ?? null}
      />
    </Skeletonize>
  );
}

// =============================================================================
// Form — Built-in/External type select → external-backend select → per-backend
// fields + write-only secret, with a persistent deployment-scope banner and a
// confirm-on-save dialog.
// =============================================================================
function VectorDatabaseForm({
  organizationId,
  initialConfig,
  hash,
  hasApiKey,
  maskedApiKey,
  hasPassword,
  maskedPassword,
}: {
  organizationId: string;
  initialConfig: VectorDbConfig;
  hash: string | null;
  hasApiKey: boolean;
  maskedApiKey: string | null;
  hasPassword: boolean;
  maskedPassword: string | null;
}) {
  const { t } = useT('settings');
  const { t: tNav } = useT('navigation');
  const { toast } = useToast();

  const saveConfig = useSaveVectorDbConfig();
  const saveSecret = useSaveVectorDbSecret();
  const testConnection = useTestVectorDbConnection();

  const defaults = useMemo(() => configToForm(initialConfig), [initialConfig]);
  const { register, handleSubmit, watch, setValue, reset } =
    useForm<VectorDbFormData>({ defaultValues: defaults });
  useEffect(() => reset(defaults), [defaults, reset]);

  const backend = watch('backend');
  const preferGrpc = watch('preferGrpc');
  const pgSslmode = watch('pgSslmode');

  const backendType: BackendType =
    backend === 'pgvector' ? 'builtin' : 'external';
  const externalBackend: ExternalBackend =
    backend === 'pgvector_external' ? 'pgvector_external' : 'qdrant';

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acked, setAcked] = useState(false);
  const [pending, setPending] = useState<VectorDbFormData | null>(null);

  const backendLabelOf = useCallback(
    (b: Backend) =>
      b === 'qdrant'
        ? t('vectorDatabase.backend.qdrant')
        : b === 'pgvector_external'
          ? t('vectorDatabase.backend.pgvectorExternal')
          : t('vectorDatabase.backend.pgvector'),
    [t],
  );

  const backendTypeOptions = useMemo(
    () => [
      { value: 'builtin', label: t('vectorDatabase.backendType.builtin') },
      { value: 'external', label: t('vectorDatabase.backendType.external') },
    ],
    [t],
  );

  const externalBackendOptions = useMemo(
    () => [
      { value: 'qdrant', label: t('vectorDatabase.backend.qdrant') },
      {
        value: 'pgvector_external',
        label: t('vectorDatabase.backend.pgvectorExternal'),
      },
    ],
    [t],
  );

  const sslModeOptions = useMemo(
    () => SSL_MODES.map((m) => ({ value: m, label: m })),
    [],
  );

  const openConfirm = useCallback((values: VectorDbFormData) => {
    setPending(values);
    setAcked(false);
    setConfirmOpen(true);
  }, []);

  const persistSecret = useCallback(
    async (incoming: { apiKey?: string; password?: string }, force = false) => {
      try {
        await saveSecret.mutateAsync({ organizationId, ...incoming, force });
      } catch (err) {
        const data = readConvexErrorData(err);
        if (data?.code === 'VECTORDB_SECRET_REFUSED_OVERWRITE') {
          // The existing secret file is unreadable; ask before discarding it.
          // eslint-disable-next-line no-alert -- minimal force-overwrite confirm; mirrors providers
          if (window.confirm(t('vectorDatabase.overwrite.body'))) {
            await saveSecret.mutateAsync({
              organizationId,
              ...incoming,
              force: true,
            });
            return;
          }
        }
        throw err;
      }
    },
    [organizationId, saveSecret, t],
  );

  const runSave = useCallback(
    async (values: VectorDbFormData, force: boolean) => {
      // Write the secret BEFORE the config so the active backend only flips
      // once its credential is stored — a config-write failure can never leave
      // an active external backend with no/old credential. An orphan secret
      // (config write fails) is harmless and overwritten on the next save.
      if (values.backend === 'qdrant' && values.apiKey.trim()) {
        await persistSecret({ apiKey: values.apiKey.trim() });
      } else if (
        values.backend === 'pgvector_external' &&
        values.password.trim()
      ) {
        await persistSecret({ password: values.password.trim() });
      }
      await saveConfig.mutateAsync({
        organizationId,
        config: toConfig(values),
        expectedHash: force ? undefined : (hash ?? undefined),
        force: force || undefined,
      });
    },
    [organizationId, hash, saveConfig, persistSecret],
  );

  const commit = useCallback(async () => {
    if (!pending) return;
    const values = pending;
    setConfirmOpen(false);
    try {
      await runSave(values, false);
      toast({ title: t('vectorDatabase.saved'), variant: 'success' });
    } catch (err) {
      console.error(err);
      const code = readConvexErrorData(err)?.code;
      if (code === 'VECTORDB_CONFIG_UNREADABLE') {
        // The stored config is corrupt; offer to overwrite it (force) so the
        // operator can self-repair instead of being permanently wedged.
        // eslint-disable-next-line no-alert -- minimal overwrite confirm; mirrors providers
        if (window.confirm(t('vectorDatabase.configUnreadableConfirm'))) {
          try {
            await runSave(values, true);
            toast({ title: t('vectorDatabase.saved'), variant: 'success' });
          } catch (forceErr) {
            console.error(forceErr);
            toast({
              title: t('vectorDatabase.saveFailed'),
              variant: 'destructive',
            });
          }
        }
      } else if (code === 'VECTORDB_VERSION_CONFLICT') {
        toast({
          title: t('vectorDatabase.versionConflict'),
          variant: 'destructive',
        });
      } else if (code === 'INVALID_VECTORDB_CONFIG') {
        toast({
          title: t('vectorDatabase.invalidConfig'),
          variant: 'destructive',
        });
      } else {
        toast({
          title: t('vectorDatabase.saveFailed'),
          variant: 'destructive',
        });
      }
    } finally {
      setPending(null);
    }
  }, [pending, runSave, toast, t]);

  const runTest = useCallback(async () => {
    const values = watch();
    try {
      const result = await testConnection.mutateAsync({
        organizationId,
        config: toConfig(values),
        apiKey: values.apiKey.trim() || undefined,
        password: values.password.trim() || undefined,
      });
      if (result.ok) {
        toast({
          title:
            result.backend === 'pgvector'
              ? t('vectorDatabase.pgvectorHint')
              : t('vectorDatabase.testOk', {
                  status: String(result.status ?? ''),
                  latency: String(result.latencyMs ?? ''),
                }),
          variant: 'success',
        });
      } else {
        toast({
          title: t('vectorDatabase.testFailed', { error: result.error ?? '' }),
          variant: 'destructive',
        });
      }
    } catch (err) {
      console.error(err);
      toast({
        title: t('vectorDatabase.testFailed', { error: String(err) }),
        variant: 'destructive',
      });
    }
  }, [watch, organizationId, testConnection, toast, t]);

  const activeBackendLabel = backendLabelOf(initialConfig.backend);
  const canTest = backend === 'qdrant' || backend === 'pgvector_external';
  const busy = saveConfig.isPending || saveSecret.isPending;

  return (
    <SettingsPage
      title={tNav('vectorDatabase')}
      description={t('menu.vectorDatabase.description')}
      narrow
    >
      <Banner
        variant="warning"
        dismissible={false}
        message={t('vectorDatabase.deploymentBanner')}
      />

      <SettingsSection
        title={t('vectorDatabase.title')}
        description={`${t('vectorDatabase.activeBackend')}: ${activeBackendLabel}`}
      >
        <Form id="vector-database-form" onSubmit={handleSubmit(openConfirm)}>
          <fieldset disabled={busy} className="contents space-y-4">
            <Select
              id="vectordb-backend-type"
              label={t('vectorDatabase.backendLabel')}
              value={backendType}
              onValueChange={(value) => {
                if (value !== 'builtin' && value !== 'external') return;
                if (value === backendType) return;
                // Switching to external defaults to Qdrant; the sub-select
                // below then lets the operator pick PostgreSQL.
                setValue(
                  'backend',
                  value === 'builtin' ? 'pgvector' : 'qdrant',
                  {
                    shouldDirty: true,
                  },
                );
              }}
              options={backendTypeOptions}
              wrapperClassName="max-w-sm"
            />

            {backendType === 'external' && (
              <Select
                id="vectordb-external-backend"
                label={t('vectorDatabase.externalBackendLabel')}
                value={externalBackend}
                onValueChange={(value) => {
                  if (value !== 'qdrant' && value !== 'pgvector_external')
                    return;
                  if (value === backend) return;
                  setValue('backend', value, { shouldDirty: true });
                }}
                options={externalBackendOptions}
                wrapperClassName="max-w-sm"
              />
            )}

            {backend === 'qdrant' && (
              <>
                <Input
                  id="vectordb-qdrant-url"
                  label={t('vectorDatabase.qdrantUrlLabel')}
                  description={t('vectorDatabase.qdrantUrlHelp')}
                  placeholder="http://qdrant:6333"
                  {...register('qdrantUrl')}
                  wrapperClassName="max-w-sm"
                />
                <Input
                  id="vectordb-collection"
                  label={t('vectorDatabase.collectionLabel')}
                  description={t('vectorDatabase.collectionHelp')}
                  {...register('collection')}
                  wrapperClassName="max-w-sm"
                />
                <Switch
                  id="vectordb-prefer-grpc"
                  label={t('vectorDatabase.preferGrpcLabel')}
                  checked={preferGrpc}
                  onCheckedChange={(checked) =>
                    setValue('preferGrpc', checked, { shouldDirty: true })
                  }
                />
                <Input
                  id="vectordb-api-key"
                  type="password"
                  label={t('vectorDatabase.apiKeyLabel')}
                  description={
                    hasApiKey
                      ? t('vectorDatabase.apiKeyHelpConfigured')
                      : t('vectorDatabase.apiKeyHelpNone')
                  }
                  placeholder={hasApiKey ? (maskedApiKey ?? '••••••••') : ''}
                  {...register('apiKey')}
                  wrapperClassName="max-w-sm"
                />
              </>
            )}

            {backend === 'pgvector_external' && (
              <>
                <Input
                  id="vectordb-pg-host"
                  label={t('vectorDatabase.pgHostLabel')}
                  description={t('vectorDatabase.pgHostHelp')}
                  placeholder="db.example.com"
                  {...register('pgHost')}
                  wrapperClassName="max-w-sm"
                />
                <Input
                  id="vectordb-pg-port"
                  type="number"
                  label={t('vectorDatabase.pgPortLabel')}
                  placeholder="5432"
                  {...register('pgPort', { valueAsNumber: true })}
                  wrapperClassName="max-w-sm"
                />
                <Input
                  id="vectordb-pg-database"
                  label={t('vectorDatabase.pgDatabaseLabel')}
                  {...register('pgDatabase')}
                  wrapperClassName="max-w-sm"
                />
                <Input
                  id="vectordb-pg-user"
                  label={t('vectorDatabase.pgUserLabel')}
                  {...register('pgUser')}
                  wrapperClassName="max-w-sm"
                />
                <Select
                  id="vectordb-pg-sslmode"
                  label={t('vectorDatabase.pgSslmodeLabel')}
                  value={pgSslmode}
                  onValueChange={(value) => {
                    if (!isSslMode(value)) return;
                    if (value === pgSslmode) return;
                    setValue('pgSslmode', value, { shouldDirty: true });
                  }}
                  options={sslModeOptions}
                  wrapperClassName="max-w-sm"
                />
                <Input
                  id="vectordb-pg-table"
                  label={t('vectorDatabase.pgTableLabel')}
                  description={t('vectorDatabase.pgTableHelp')}
                  {...register('pgTable')}
                  wrapperClassName="max-w-sm"
                />
                <Input
                  id="vectordb-pg-password"
                  type="password"
                  label={t('vectorDatabase.passwordLabel')}
                  description={
                    hasPassword
                      ? t('vectorDatabase.passwordHelpConfigured')
                      : t('vectorDatabase.passwordHelpNone')
                  }
                  placeholder={
                    hasPassword ? (maskedPassword ?? '••••••••') : ''
                  }
                  {...register('password')}
                  wrapperClassName="max-w-sm"
                />
              </>
            )}

            <div className="flex gap-2 pt-2">
              <Button type="submit" disabled={busy}>
                {busy ? t('vectorDatabase.saving') : t('vectorDatabase.save')}
              </Button>
              {canTest && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={runTest}
                  disabled={testConnection.isPending}
                >
                  {testConnection.isPending
                    ? t('vectorDatabase.testing')
                    : t('vectorDatabase.testConnection')}
                </Button>
              )}
            </div>
          </fieldset>
        </Form>
      </SettingsSection>

      <Dialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t('vectorDatabase.confirm.title')}
        description={
          pending && pending.backend !== initialConfig.backend
            ? t('vectorDatabase.confirm.body', {
                from: activeBackendLabel,
                to: backendLabelOf(pending.backend),
              })
            : t('vectorDatabase.confirm.bodySameBackend')
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              {t('vectorDatabase.confirm.cancel')}
            </Button>
            <Button onClick={commit} disabled={!acked}>
              {t('vectorDatabase.confirm.confirm')}
            </Button>
          </>
        }
      >
        <Checkbox
          id="vectordb-ack"
          label={t('vectorDatabase.confirm.ack')}
          checked={acked}
          onCheckedChange={(checked) => setAcked(checked === true)}
        />
      </Dialog>
    </SettingsPage>
  );
}
