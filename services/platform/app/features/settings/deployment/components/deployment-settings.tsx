'use client';

/**
 * Deployment-level data-residency settings (instance admin).
 *
 * NOTE: strings are English literals for now — extract to the i18n catalogs
 * via the `translation` skill (en/de/de-CH/fr) as a follow-up. `api.deployment.*`
 * resolves after `convex codegen` (runs on dev/deploy).
 *
 * This is the first panel of an extensible deployment-settings surface; future
 * deployment sections (SMTP, telemetry, …) can render alongside `DataStores`.
 */

import { Button } from '@tale/ui/button';
import { Input } from '@tale/ui/input';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useEffect, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';

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
  uiEnabled?: boolean;
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
          External Postgres
        </label>
      </div>
      {state.enabled ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Labeled label="Host">
            <Input
              value={state.host}
              disabled={disabled}
              onChange={(e) => setState({ ...state, host: e.target.value })}
            />
          </Labeled>
          <Labeled label="Port">
            <Input
              type="number"
              value={state.port}
              disabled={disabled}
              onChange={(e) => setState({ ...state, port: e.target.value })}
            />
          </Labeled>
          <Labeled label="Database">
            <Input
              value={state.database}
              disabled={disabled}
              onChange={(e) => setState({ ...state, database: e.target.value })}
            />
          </Labeled>
          <Labeled label="User">
            <Input
              value={state.user}
              disabled={disabled}
              onChange={(e) => setState({ ...state, user: e.target.value })}
            />
          </Labeled>
          <Labeled label="SSL mode">
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
            label="Password"
            hint={
              secretMasked
                ? `Stored: ${secretMasked} — leave blank to keep`
                : 'Write-only; leave blank to keep the stored value'
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
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            {testResult ? (
              <span
                className={
                  testResult.ok
                    ? 'text-sm text-green-600'
                    : 'text-destructive text-sm'
                }
              >
                {testResult.ok ? 'OK' : 'Failed'}
                {testResult.message ? ` — ${testResult.message}` : ''}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Using the built-in shared database.
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
  const cfg = data?.config ?? { version: 1 };
  const ds = cfg.dataStores ?? {};
  const secretState = data?.secrets ?? {};
  const uiEnabled: boolean = Boolean(data?.uiEnabled);
  const readOnly = !uiEnabled;

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
        setRestartMsg(res.error || 'Restart controller not enabled.');
      } else if (res?.ok) {
        setRestartMsg(
          `Restarted: ${(res.restarted ?? []).join(', ') || 'rag, convex'}`,
        );
      } else {
        setRestartMsg(
          `Restart failed: ${res?.error || (res?.errors ?? []).join('; ') || 'unknown error'}`,
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
      title="Data residency"
      description="Point this deployment's knowledge database and file storage at infrastructure you control. Changes apply when the RAG and Convex containers restart."
    >
      <div className="flex max-w-3xl flex-col gap-4">
        {readOnly ? (
          <Banner tone="info">
            Editing is disabled. Set <code>TALE_DEPLOYMENT_CONFIG_UI=true</code>{' '}
            in the deployment environment and restart to enable changes here.
          </Banner>
        ) : null}
        {data?.secretsError === 'encrypted_no_key' ? (
          <Banner tone="warning">
            The stored secrets are SOPS-encrypted but no age key is configured —
            existing secrets can&apos;t be read.
          </Banner>
        ) : null}

        <PgSection
          title="Knowledge database (RAG)"
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
            The external knowledge database must run ParadeDB (pgvector +
            pg_search) for full hybrid search; plain pgvector degrades to
            vector-only.
          </Banner>
        ) : null}

        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">File storage (uploaded documents)</h3>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={storage.s3}
                disabled={readOnly}
                onChange={(e) =>
                  setStorage({ ...storage, s3: e.target.checked })
                }
              />
              External S3
            </label>
          </div>
          {storage.s3 ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Labeled label="Region">
                  <Input
                    value={storage.region}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({ ...storage, region: e.target.value })
                    }
                  />
                </Labeled>
                <Labeled label="Endpoint (MinIO/R2; blank for AWS)">
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
                  Force path-style (MinIO/R2)
                </label>
                <div />
                <Labeled label="Files bucket">
                  <Input
                    value={storage.files}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({ ...storage, files: e.target.value })
                    }
                  />
                </Labeled>
                <Labeled label="Exports bucket">
                  <Input
                    value={storage.exports}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({ ...storage, exports: e.target.value })
                    }
                  />
                </Labeled>
                <Labeled label="Snapshot-imports bucket">
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
                <Labeled label="Modules bucket">
                  <Input
                    value={storage.modules}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({ ...storage, modules: e.target.value })
                    }
                  />
                </Labeled>
                <Labeled label="Search bucket">
                  <Input
                    value={storage.search}
                    disabled={readOnly}
                    onChange={(e) =>
                      setStorage({ ...storage, search: e.target.value })
                    }
                  />
                </Labeled>
                <Labeled
                  label="Access key ID"
                  hint={
                    secretState['dataStores.convexStorage.accessKeyId']?.masked
                      ? `Stored: ${secretState['dataStores.convexStorage.accessKeyId'].masked} — leave blank to keep`
                      : 'Write-only'
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
                <Labeled label="Secret access key" hint="Write-only">
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
                    ? 'Testing…'
                    : 'Test reachability'}
                </Button>
                {testResults.convexStorage ? (
                  <span
                    className={
                      testResults.convexStorage.ok
                        ? 'text-sm text-green-600'
                        : 'text-destructive text-sm'
                    }
                  >
                    {testResults.convexStorage.ok ? 'Reachable' : 'Failed'}
                    {testResults.convexStorage.message
                      ? ` — ${testResults.convexStorage.message}`
                      : ''}
                  </span>
                ) : null}
              </div>
              <Banner tone="warning">
                S3 storage is greenfield: switching from local does NOT migrate
                existing uploaded files. Set this at initial deploy, or copy the
                local blobs into the bucket separately.
              </Banner>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Files are stored on the local Convex volume.
            </p>
          )}
        </section>

        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-semibold">
            Application database (advanced)
          </summary>
          <div className="mt-3">
            <PgSection
              title="Convex metadata database"
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
            Saved. <strong>Restart to apply:</strong> run{' '}
            <code>docker compose restart rag convex</code> (or{' '}
            <code>tale deploy --services rag</code> for zero-downtime). The
            platform itself does not need restarting.
          </Banner>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void onSave()} disabled={readOnly || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void onRestart()}
            disabled={readOnly || restarting}
            title="Restart rag + convex via the controller (if enabled), or shows the manual command"
          >
            {restarting ? 'Restarting…' : 'Apply & restart'}
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
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const query = useReadDeploymentConfig();

  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return (
      <AccessDenied message="You need administrator access to view deployment settings." />
    );
  }

  return (
    <Skeletonize loading={abilityLoading || query.isPending}>
      <DeploymentSettingsView data={query.data} />
    </Skeletonize>
  );
}
