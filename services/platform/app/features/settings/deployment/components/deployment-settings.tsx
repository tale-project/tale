'use client';

/**
 * Deployment-level data-residency settings (instance admin).
 *
 * This is the first panel of an extensible deployment-settings surface; future
 * deployment sections (SMTP, telemetry, …) can render alongside `DataStores`.
 * `api.deployment.*` resolves after `convex codegen` (runs on dev/deploy).
 *
 * Strings live in `settings.dataResidency.*` / `navigation.dataResidency` /
 * `accessDenied.deployment` across en/de/fr (de-CH inherits de). Code tokens
 * (env vars, shell commands, bucket names) stay English in every locale.
 */

import { Button } from '@tale/ui/button';
import { Input } from '@tale/ui/input';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useEffect, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';

import {
  useRequestRestart,
  useSaveDeploymentConfig,
  useSaveDeploymentSecret,
  useTestDeploymentConnection,
} from '../hooks/mutations';
import { useReadDeploymentConfig } from '../hooks/queries';

const SSL_MODES = ['disable', 'prefer', 'require', 'verify-ca', 'verify-full'];

type PgForm = {
  enabled: boolean;
  host: string;
  port: string;
  database: string;
  user: string;
  sslmode: string;
  password: string; // write-only; blank = keep stored
};

type StorageForm = {
  s3: boolean;
  region: string;
  endpoint: string;
  forcePathStyle: boolean;
  files: string;
  exports: string;
  snapshotImports: string;
  modules: string;
  search: string;
  accessKeyId: string; // write-only
  secretAccessKey: string; // write-only
};

/** Loose shape of the JSON the read action returns (deployment.json is v.any()). */
type PgConfigJson = {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  sslmode?: string;
};

type DeploymentReadData = {
  config?: {
    version?: number;
    dataStores?: {
      knowledgePostgres?: PgConfigJson;
      appPostgres?: PgConfigJson;
      convexStorage?: {
        mode?: string;
        region?: string;
        endpoint?: string;
        forcePathStyle?: boolean;
        buckets?: Record<string, string>;
      };
    };
  };
  hash?: string | null;
  secrets?: Record<string, { present: boolean; masked?: string }>;
  secretsError?: string;
  /** Whether THIS caller may edit (their email is in the editor allowlist). */
  canEdit?: boolean;
  /** The caller's own email — surfaced in the read-only banner. */
  email?: string;
};

type ConnTestResult = {
  ok?: boolean;
  configured?: boolean;
  error?: string;
  errors?: string[];
  restarted?: string[];
  hint?: string;
  latencyMs?: number;
};

const emptyPg = (): PgForm => ({
  enabled: false,
  host: '',
  port: '5432',
  database: '',
  user: '',
  sslmode: 'require',
  password: '',
});

function pgFromConfig(pg: PgConfigJson | undefined): PgForm {
  if (!pg) return emptyPg();
  return {
    enabled: true,
    host: pg.host ?? '',
    port: String(pg.port ?? 5432),
    database: pg.database ?? '',
    user: pg.user ?? '',
    sslmode: pg.sslmode ?? 'require',
    password: '',
  };
}

function Banner({
  tone,
  children,
}: {
  tone: 'info' | 'warning';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'warning'
      ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
      : 'border-border bg-muted/40 text-foreground';
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${cls}`}>
      {children}
    </div>
  );
}

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? (
        <span className="text-muted-foreground text-xs">{hint}</span>
      ) : null}
    </label>
  );
}

function PgSection({
  title,
  state,
  setState,
  secretMasked,
  onTest,
  testing,
  testResult,
  disabled,
}: {
  title: string;
  state: PgForm;
  setState: (next: PgForm) => void;
  secretMasked?: string;
  onTest: () => void;
  testing: boolean;
  testResult?: { ok: boolean; message?: string };
  disabled: boolean;
}) {
  const { t } = useT('settings');
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.enabled}
            disabled={disabled}
            onChange={(e) => setState({ ...state, enabled: e.target.checked })}
          />
          {t('dataResidency.externalPostgres')}
        </label>
      </div>
      {state.enabled ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label={t('dataResidency.field.host')}>
            <Input
              value={state.host}
              disabled={disabled}
              onChange={(e) => setState({ ...state, host: e.target.value })}
            />
          </Labeled>
          <Labeled label={t('dataResidency.field.port')}>
            <Input
              type="number"
              value={state.port}
              disabled={disabled}
              onChange={(e) => setState({ ...state, port: e.target.value })}
            />
          </Labeled>
          <Labeled label={t('dataResidency.field.database')}>
            <Input
              value={state.database}
              disabled={disabled}
              onChange={(e) => setState({ ...state, database: e.target.value })}
            />
          </Labeled>
          <Labeled label={t('dataResidency.field.user')}>
            <Input
              value={state.user}
              disabled={disabled}
              onChange={(e) => setState({ ...state, user: e.target.value })}
            />
          </Labeled>
          <Labeled label={t('dataResidency.field.sslMode')}>
            <select
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
              value={state.sslmode}
              disabled={disabled}
              onChange={(e) => setState({ ...state, sslmode: e.target.value })}
            >
              {SSL_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled
            label={t('dataResidency.field.password')}
            hint={
              secretMasked
                ? t('dataResidency.password.storedHint', {
                    masked: secretMasked,
                  })
                : t('dataResidency.password.writeOnlyHint')
            }
          >
            <Input
              type="password"
              value={state.password}
              disabled={disabled}
              onChange={(e) => setState({ ...state, password: e.target.value })}
            />
          </Labeled>
          <div className="flex items-center gap-3 sm:col-span-2">
            <Button
              variant="secondary"
              onClick={onTest}
              disabled={disabled || testing}
            >
              {testing
                ? t('dataResidency.testing')
                : t('dataResidency.testConnection')}
            </Button>
            {testResult ? (
              <span
                className={
                  testResult.ok
                    ? 'text-sm text-green-600'
                    : 'text-destructive text-sm'
                }
              >
                {testResult.ok
                  ? t('dataResidency.result.ok')
                  : t('dataResidency.result.failed')}
                {testResult.message ? ` — ${testResult.message}` : ''}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t('dataResidency.usingSharedDatabase')}
        </p>
      )}
    </section>
  );
}

function DeploymentSettingsView({
  data,
}: {
  data: DeploymentReadData | undefined;
}) {
  const { t } = useT('settings');
  const { t: tNav } = useT('navigation');
  const cfg = data?.config ?? { version: 1 };
  const ds = cfg.dataStores ?? {};
  const secretState = data?.secrets ?? {};
  const canEdit: boolean = Boolean(data?.canEdit);
  const readOnly = !canEdit;

  const [knowledge, setKnowledge] = useState<PgForm>(() =>
    pgFromConfig(ds.knowledgePostgres),
  );
  const [appPg, setAppPg] = useState<PgForm>(() =>
    pgFromConfig(ds.appPostgres),
  );
  const [storage, setStorage] = useState<StorageForm>(() => {
    const cs = ds.convexStorage;
    const s3 = cs?.mode === 's3';
    return {
      s3,
      region: cs?.region ?? '',
      endpoint: cs?.endpoint ?? '',
      forcePathStyle: Boolean(cs?.forcePathStyle),
      files: cs?.buckets?.files ?? '',
      exports: cs?.buckets?.exports ?? '',
      snapshotImports: cs?.buckets?.snapshotImports ?? '',
      modules: cs?.buckets?.modules ?? '',
      search: cs?.buckets?.search ?? '',
      accessKeyId: '',
      secretAccessKey: '',
    };
  });

  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message?: string }>
  >({});

  const saveConfig = useSaveDeploymentConfig();
  const saveSecret = useSaveDeploymentSecret();
  const testConn = useTestDeploymentConnection();
  const restartHook = useRequestRestart();
  const [restarting, setRestarting] = useState(false);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);

  async function onRestart() {
    setRestarting(true);
    setRestartMsg(null);
    try {
      const res: ConnTestResult = await restartHook.mutateAsync({});
      if (res?.configured === false) {
        setRestartMsg(res.error || t('dataResidency.restart.notEnabled'));
      } else if (res?.ok) {
        setRestartMsg(
          t('dataResidency.restart.restarted', {
            services:
              (res.restarted ?? []).join(', ') ||
              t('dataResidency.restart.defaultServices'),
          }),
        );
      } else {
        setRestartMsg(
          t('dataResidency.restart.failed', {
            error:
              res?.error ||
              (res?.errors ?? []).join('; ') ||
              t('dataResidency.restart.unknownError'),
          }),
        );
      }
    } catch (err) {
      setRestartMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setRestarting(false);
    }
  }

  // Reset local form when a fresh read lands (e.g. after invalidation).
  useEffect(() => {
    setKnowledge(pgFromConfig(ds.knowledgePostgres));
    setAppPg(pgFromConfig(ds.appPostgres));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.hash]);

  function buildPg(form: PgForm) {
    return {
      host: form.host,
      port: Number(form.port) || 5432,
      database: form.database,
      user: form.user,
      sslmode: form.sslmode,
    };
  }

  function buildConfig() {
    const dataStores: Record<string, unknown> = {};
    if (knowledge.enabled) dataStores.knowledgePostgres = buildPg(knowledge);
    if (appPg.enabled) dataStores.appPostgres = buildPg(appPg);
    dataStores.convexStorage = storage.s3
      ? {
          mode: 's3',
          region: storage.region,
          ...(storage.endpoint ? { endpoint: storage.endpoint } : {}),
          forcePathStyle: storage.forcePathStyle,
          buckets: {
            files: storage.files,
            exports: storage.exports,
            snapshotImports: storage.snapshotImports,
            modules: storage.modules,
            search: storage.search,
          },
        }
      : { mode: 'local' };
    return { version: 1, dataStores };
  }

  function buildSecrets() {
    const out: Record<string, string> = {};
    if (knowledge.enabled && knowledge.password)
      out['dataStores.knowledgePostgres.password'] = knowledge.password;
    if (appPg.enabled && appPg.password)
      out['dataStores.appPostgres.password'] = appPg.password;
    if (storage.s3) {
      if (storage.accessKeyId)
        out['dataStores.convexStorage.accessKeyId'] = storage.accessKeyId;
      if (storage.secretAccessKey)
        out['dataStores.convexStorage.secretAccessKey'] =
          storage.secretAccessKey;
    }
    return out;
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const secrets = buildSecrets();
      if (Object.keys(secrets).length > 0) {
        await saveSecret.mutateAsync({ secrets });
      }
      await saveConfig.mutateAsync({
        config: buildConfig(),
        expectedHash: data?.hash ?? undefined,
      });
      setSavedOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function runTest(
    target: 'knowledgePostgres' | 'appPostgres' | 'convexStorage',
  ) {
    setTesting(target);
    try {
      const form =
        target === 'convexStorage'
          ? null
          : target === 'knowledgePostgres'
            ? knowledge
            : appPg;
      const config =
        target === 'convexStorage'
          ? storage.s3
            ? {
                mode: 's3',
                region: storage.region,
                ...(storage.endpoint ? { endpoint: storage.endpoint } : {}),
                forcePathStyle: storage.forcePathStyle,
                buckets: {
                  files: storage.files,
                  exports: storage.exports,
                  snapshotImports: storage.snapshotImports,
                  modules: storage.modules,
                  search: storage.search,
                },
              }
            : { mode: 'local' }
          : buildPg(form ?? emptyPg());
      const res: ConnTestResult = await testConn.mutateAsync({
        target,
        config,
        ...(form?.password ? { password: form.password } : {}),
      });
      setTestResults((prev) => ({
        ...prev,
        [target]: {
          ok: Boolean(res?.ok),
          message: res?.error || res?.hint || undefined,
        },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [target]: {
          ok: false,
          message: err instanceof Error ? err.message : String(err),
        },
      }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <SettingsPage
      title={tNav('dataResidency')}
      description={t('dataResidency.pageDescription')}
    >
      <div className="flex max-w-3xl flex-col gap-4">
        {readOnly ? (
          <Banner tone="info">
            {t('dataResidency.readOnly.before')}{' '}
            <code>TALE_DEPLOYMENT_CONFIG_ADMINS</code>{' '}
            {t('dataResidency.readOnly.after')}
            {data?.email ? (
              <>
                {' '}
                {t('dataResidency.readOnly.yourEmail', { email: data.email })}
              </>
            ) : null}
          </Banner>
        ) : null}
        {data?.secretsError === 'encrypted_no_key' ? (
          <Banner tone="warning">
            {t('dataResidency.secretsEncryptedNoKey')}
          </Banner>
        ) : null}

        <PgSection
          title={t('dataResidency.knowledge.title')}
          state={knowledge}
          setState={setKnowledge}
          secretMasked={
            secretState['dataStores.knowledgePostgres.password']?.masked
          }
          onTest={() => void runTest('knowledgePostgres')}
          testing={testing === 'knowledgePostgres'}
          testResult={testResults.knowledgePostgres}
          disabled={readOnly}
        />
        {knowledge.enabled ? (
          <Banner tone="info">
            {t('dataResidency.knowledge.paradeDbNote')}
          </Banner>
        ) : null}

        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">
              {t('dataResidency.storage.title')}
            </h3>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={storage.s3}
                disabled={readOnly}
                onChange={(e) =>
                  setStorage({ ...storage, s3: e.target.checked })
                }
              />
              {t('dataResidency.storage.externalS3')}
            </label>
          </div>
          {storage.s3 ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Labeled label={t('dataResidency.storage.region')}>
                  <Input
                    value={storage.region}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({ ...storage, region: e.target.value })
                    }
                  />
                </Labeled>
                <Labeled label={t('dataResidency.storage.endpoint')}>
                  <Input
                    value={storage.endpoint}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({ ...storage, endpoint: e.target.value })
                    }
                  />
                </Labeled>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={storage.forcePathStyle}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({
                        ...storage,
                        forcePathStyle: e.target.checked,
                      })
                    }
                  />
                  {t('dataResidency.storage.forcePathStyle')}
                </label>
                <div />
                <Labeled label={t('dataResidency.storage.bucket.files')}>
                  <Input
                    value={storage.files}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({ ...storage, files: e.target.value })
                    }
                  />
                </Labeled>
                <Labeled label={t('dataResidency.storage.bucket.exports')}>
                  <Input
                    value={storage.exports}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({ ...storage, exports: e.target.value })
                    }
                  />
                </Labeled>
                <Labeled
                  label={t('dataResidency.storage.bucket.snapshotImports')}
                >
                  <Input
                    value={storage.snapshotImports}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({
                        ...storage,
                        snapshotImports: e.target.value,
                      })
                    }
                  />
                </Labeled>
                <Labeled label={t('dataResidency.storage.bucket.modules')}>
                  <Input
                    value={storage.modules}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({ ...storage, modules: e.target.value })
                    }
                  />
                </Labeled>
                <Labeled label={t('dataResidency.storage.bucket.search')}>
                  <Input
                    value={storage.search}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({ ...storage, search: e.target.value })
                    }
                  />
                </Labeled>
                <Labeled
                  label={t('dataResidency.storage.accessKeyId')}
                  hint={
                    secretState['dataStores.convexStorage.accessKeyId']?.masked
                      ? t('dataResidency.storage.accessKeyIdStoredHint', {
                          masked:
                            secretState['dataStores.convexStorage.accessKeyId']
                              .masked,
                        })
                      : t('dataResidency.storage.writeOnly')
                  }
                >
                  <Input
                    value={storage.accessKeyId}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({ ...storage, accessKeyId: e.target.value })
                    }
                  />
                </Labeled>
                <Labeled
                  label={t('dataResidency.storage.secretAccessKey')}
                  hint={t('dataResidency.storage.writeOnly')}
                >
                  <Input
                    type="password"
                    value={storage.secretAccessKey}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({
                        ...storage,
                        secretAccessKey: e.target.value,
                      })
                    }
                  />
                </Labeled>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() => void runTest('convexStorage')}
                  disabled={readOnly || testing === 'convexStorage'}
                >
                  {testing === 'convexStorage'
                    ? t('dataResidency.testing')
                    : t('dataResidency.storage.testReachability')}
                </Button>
                {testResults.convexStorage ? (
                  <span
                    className={
                      testResults.convexStorage.ok
                        ? 'text-sm text-green-600'
                        : 'text-destructive text-sm'
                    }
                  >
                    {testResults.convexStorage.ok
                      ? t('dataResidency.storage.reachable')
                      : t('dataResidency.result.failed')}
                    {testResults.convexStorage.message
                      ? ` — ${testResults.convexStorage.message}`
                      : ''}
                  </span>
                ) : null}
              </div>
              <Banner tone="warning">
                {t('dataResidency.storage.greenfieldWarning')}
              </Banner>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t('dataResidency.storage.localStorageNote')}
            </p>
          )}
        </section>

        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-semibold">
            {t('dataResidency.appDb.summary')}
          </summary>
          <div className="mt-3">
            <PgSection
              title={t('dataResidency.appDb.title')}
              state={appPg}
              setState={setAppPg}
              secretMasked={
                secretState['dataStores.appPostgres.password']?.masked
              }
              onTest={() => void runTest('appPostgres')}
              testing={testing === 'appPostgres'}
              testResult={testResults.appPostgres}
              disabled={readOnly}
            />
          </div>
        </details>

        {error ? <Banner tone="warning">{error}</Banner> : null}
        {savedOk ? (
          <Banner tone="info">
            <strong>{t('dataResidency.saved.title')}</strong>{' '}
            {t('dataResidency.saved.runPrefix')}{' '}
            <code>docker compose restart rag convex</code>{' '}
            {t('dataResidency.saved.orPrefix')}{' '}
            <code>tale deploy --services rag</code>{' '}
            {t('dataResidency.saved.tail')}
          </Banner>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void onSave()} disabled={readOnly || saving}>
            {saving ? t('dataResidency.saving') : t('dataResidency.save')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void onRestart()}
            disabled={readOnly || restarting}
            title={t('dataResidency.applyRestartTitle')}
          >
            {restarting
              ? t('dataResidency.restarting')
              : t('dataResidency.applyRestart')}
          </Button>
          {restartMsg ? (
            <span className="text-muted-foreground text-sm">{restartMsg}</span>
          ) : null}
        </div>
      </div>
    </SettingsPage>
  );
}

export function DeploymentSettings() {
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const query = useReadDeploymentConfig();

  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('deployment')} />;
  }

  return (
    <Skeletonize loading={abilityLoading || query.isPending}>
      <DeploymentSettingsView data={query.data} />
    </Skeletonize>
  );
}
