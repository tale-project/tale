'use client';

/**
 * Deployment-level data-residency settings (instance admin).
 *
 * This is the first panel of an extensible deployment-settings surface; future
 * deployment sections (SMTP, telemetry, …) can render alongside the data
 * stores panel.
 * `api.deployment.*` resolves after `convex codegen` (runs on dev/deploy).
 *
 * Built on the shared settings UI (`PageSection`, app `Input`/`Select`/
 * `Switch`, `Alert`, `Stack`/`HStack`) so it matches every other settings page
 * instead of carrying bespoke banner / label / card chrome.
 *
 * Strings live in `settings.dataResidency.*` / `navigation.dataResidency` /
 * `accessDenied.deployment` across en/de/fr (de-CH inherits de). Code tokens
 * (env vars, shell commands, bucket names) stay English in every locale.
 */

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { PageSection } from '@tale/ui/page-section';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Info } from 'lucide-react';
import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { structuralEqual } from '@/lib/utils/structural-equal';

import { mapDeploymentError } from '../deployment-errors';
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
  /** Services whose restart was deferred until after the reply (e.g. convex). */
  scheduled?: string[];
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

/** Loose shape of the stored Convex-storage config the read action returns. */
type StorageConfigJson = {
  mode?: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  buckets?: Record<string, string>;
};

function storageFromConfig(cs: StorageConfigJson | undefined): StorageForm {
  return {
    s3: cs?.mode === 's3',
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
}

/** Compact inline pass/fail line shown next to a Test button. */
function TestResultLine({
  result,
  okLabel,
}: {
  result?: { ok: boolean; message?: string };
  okLabel: string;
}) {
  const { t } = useT('settings');
  if (!result) return null;
  return (
    <span
      className={cn('text-sm', result.ok ? 'text-success' : 'text-destructive')}
    >
      {result.ok ? okLabel : t('dataResidency.result.failed')}
      {result.message ? ` — ${result.message}` : ''}
    </span>
  );
}

function PgSection({
  title,
  description,
  state,
  setState,
  secretMasked,
  secretPresent,
  onTest,
  testing,
  testResult,
  disabled,
  note,
  showSslMode = true,
}: {
  title: string;
  description?: string;
  state: PgForm;
  setState: (next: PgForm) => void;
  secretMasked?: string;
  /** A stored password exists (no preview shown for credential-class secrets). */
  secretPresent?: boolean;
  onTest: () => void;
  testing: boolean;
  testResult?: { ok: boolean; message?: string };
  disabled: boolean;
  /** Contextual footnote shown below the fields while the section is enabled. */
  note?: React.ReactNode;
  /**
   * Whether to render the SSL-mode control. Off for the app (Convex metadata)
   * DB: its postgres-v5 driver derives the database from INSTANCE_NAME and
   * rejects a `?sslmode=` URL, so the boot path cannot honor a chosen mode —
   * offering the control would promise a guarantee we can't deliver.
   */
  showSslMode?: boolean;
}) {
  const { t } = useT('settings');
  return (
    <PageSection
      title={title}
      description={description}
      action={
        <Switch
          label={t('dataResidency.externalPostgres')}
          hideLabelOnMobile
          checked={state.enabled}
          disabled={disabled}
          onCheckedChange={(checked) =>
            setState({ ...state, enabled: checked })
          }
        />
      }
    >
      {state.enabled ? (
        <Stack gap={4}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('dataResidency.field.host')}
              value={state.host}
              disabled={disabled}
              onChange={(e) => setState({ ...state, host: e.target.value })}
            />
            <Input
              label={t('dataResidency.field.port')}
              type="number"
              value={state.port}
              disabled={disabled}
              onChange={(e) => setState({ ...state, port: e.target.value })}
            />
            <Input
              label={t('dataResidency.field.database')}
              value={state.database}
              disabled={disabled}
              onChange={(e) => setState({ ...state, database: e.target.value })}
            />
            <Input
              label={t('dataResidency.field.user')}
              value={state.user}
              disabled={disabled}
              onChange={(e) => setState({ ...state, user: e.target.value })}
            />
            {showSslMode ? (
              <Select
                label={t('dataResidency.field.sslMode')}
                value={state.sslmode}
                disabled={disabled}
                onValueChange={(v) => setState({ ...state, sslmode: v })}
                options={SSL_MODES.map((m) => ({ value: m, label: m }))}
              />
            ) : null}
            <Input
              label={t('dataResidency.field.password')}
              type="password"
              value={state.password}
              disabled={disabled}
              onChange={(e) => setState({ ...state, password: e.target.value })}
              description={
                secretMasked
                  ? t('dataResidency.password.storedHint', {
                      masked: secretMasked,
                    })
                  : secretPresent
                    ? t('dataResidency.password.storedNoPreviewHint')
                    : t('dataResidency.password.writeOnlyHint')
              }
            />
          </div>
          <HStack gap={3} align="center" className="flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={onTest}
              disabled={disabled || testing}
            >
              {testing
                ? t('dataResidency.testing')
                : t('dataResidency.testConnection')}
            </Button>
            <TestResultLine
              result={testResult}
              okLabel={t('dataResidency.result.ok')}
            />
          </HStack>
          {note}
        </Stack>
      ) : (
        <p className="text-muted-foreground text-sm">
          {t('dataResidency.usingSharedDatabase')}
        </p>
      )}
    </PageSection>
  );
}

function DeploymentSettingsView({
  data,
}: {
  data: DeploymentReadData | undefined;
}) {
  const { t } = useT('settings');
  const cfg = data?.config ?? { version: 1 };
  const ds = cfg.dataStores ?? {};
  const secretState = data?.secrets ?? {};
  const canEdit: boolean = Boolean(data?.canEdit);
  const readOnly = !canEdit;

  const [knowledge, setKnowledgeRaw] = useState<PgForm>(() =>
    pgFromConfig(ds.knowledgePostgres),
  );
  const [appPg, setAppPgRaw] = useState<PgForm>(() =>
    pgFromConfig(ds.appPostgres),
  );
  const [storage, setStorageRaw] = useState<StorageForm>(() =>
    storageFromConfig(ds.convexStorage),
  );

  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceOverwriteOpen, setForceOverwriteOpen] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; message?: string }>
  >({});

  // Editing a section clears the stale failed-save banner and that section's
  // now-outdated test result so the operator never sees feedback that no longer
  // matches the form. (The "Saved" and restart banners are gated on !isDirty in
  // render, so they hide on edit without being cleared here.)
  function clearStaleFeedback(section: string) {
    setError(null);
    setTestResults((prev) => {
      if (!(section in prev)) return prev;
      const next = { ...prev };
      delete next[section];
      return next;
    });
  }
  const setKnowledge: Dispatch<SetStateAction<PgForm>> = (a) => {
    clearStaleFeedback('knowledgePostgres');
    setKnowledgeRaw(a);
  };
  const setAppPg: Dispatch<SetStateAction<PgForm>> = (a) => {
    clearStaleFeedback('appPostgres');
    setAppPgRaw(a);
  };
  const setStorage: Dispatch<SetStateAction<StorageForm>> = (a) => {
    clearStaleFeedback('convexStorage');
    setStorageRaw(a);
  };

  const saveConfig = useSaveDeploymentConfig();
  const saveSecret = useSaveDeploymentSecret();
  const testConn = useTestDeploymentConnection();
  const restartHook = useRequestRestart();
  const [restarting, setRestarting] = useState(false);
  const [restartMsg, setRestartMsg] = useState<string | null>(null);
  // "Apply & restart" bounces the rag + convex containers (brief downtime), so
  // it stays available (an operator may apply an earlier/hand-edited config)
  // but always goes through a confirmation.
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false);

  async function onRestart() {
    setRestarting(true);
    setRestartMsg(null);
    try {
      const res: ConnTestResult = await restartHook.mutateAsync({});
      if (res?.configured === false) {
        setRestartMsg(res.error || t('dataResidency.restart.notEnabled'));
      } else if (res?.ok) {
        // `convex` is bounced just after this reply, so it arrives under
        // `scheduled` rather than `restarted` — surface both as "requested".
        const services = [...(res.restarted ?? []), ...(res.scheduled ?? [])];
        setRestartMsg(
          t('dataResidency.restart.requested', {
            services:
              services.join(', ') || t('dataResidency.restart.defaultServices'),
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
      setRestartMsg(mapDeploymentError(err, t).message);
    } finally {
      setRestarting(false);
      setRestartConfirmOpen(false);
    }
  }

  // Reset local form when a fresh read lands (e.g. after a save invalidates
  // the query). Resetting all three sections to the freshly-read baseline is
  // also what clears the dirty state after a successful save.
  useEffect(() => {
    setKnowledge(pgFromConfig(ds.knowledgePostgres));
    setAppPg(pgFromConfig(ds.appPostgres));
    setStorage(storageFromConfig(ds.convexStorage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.hash]);

  // Dirty = the form differs from the loaded config, OR a write-only secret
  // field was entered (secret fields are blank in the baseline, so a non-empty
  // value naturally shows up as a diff). Drives whether Save is enabled.
  const isDirty =
    !structuralEqual(knowledge, pgFromConfig(ds.knowledgePostgres)) ||
    !structuralEqual(appPg, pgFromConfig(ds.appPostgres)) ||
    !structuralEqual(storage, storageFromConfig(ds.convexStorage));

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

  // Persist the hash-guarded config. Config-first (saved before any secret) is
  // load-bearing: on a concurrent change the stale `expectedHash` aborts HERE —
  // before any secret is written — so a version conflict can neither orphan a
  // secret on disk nor let the secret-save's query invalidation re-baseline
  // (and wipe) the operator's unsaved edits.
  async function persistConfig() {
    await saveConfig.mutateAsync({
      config: buildConfig(),
      expectedHash: data?.hash ?? undefined,
    });
  }

  // Persist secrets (optionally force-overwriting an undecryptable sidecar).
  async function persistSecrets(force: boolean) {
    const secrets = buildSecrets();
    if (Object.keys(secrets).length === 0) return;
    await saveSecret.mutateAsync({
      secrets,
      ...(force ? { force: true } : {}),
    });
  }

  // Clear the write-only secret inputs + mark saved. A config change refetches
  // and re-baselines the form, but a secret-only save leaves the config hash
  // unchanged, so clearing here is what drops the form back to a clean
  // (non-dirty) state in that case.
  function finishSave() {
    setKnowledgeRaw((k) => ({ ...k, password: '' }));
    setAppPgRaw((a) => ({ ...a, password: '' }));
    setStorageRaw((s) => ({ ...s, accessKeyId: '', secretAccessKey: '' }));
    setSavedOk(true);
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      await persistConfig();
      await persistSecrets(false);
      finishSave();
    } catch (err) {
      const mapped = mapDeploymentError(err, t);
      setError(mapped.message);
      // An undecryptable existing secrets sidecar can only be recovered by an
      // explicit force-overwrite — offer it via a confirm dialog. The config is
      // already persisted (config-first), so the retry re-saves ONLY the secret.
      if (mapped.canForceOverwrite) setForceOverwriteOpen(true);
    } finally {
      setSaving(false);
    }
  }

  async function onForceOverwrite() {
    setSaving(true);
    setError(null);
    try {
      // Config is already saved; only the secret sidecar needs the force
      // overwrite. Re-saving config here could spuriously version-conflict
      // against its own just-written hash before the read query refetches.
      await persistSecrets(true);
      finishSave();
    } catch (err) {
      setError(mapDeploymentError(err, t).message);
    } finally {
      setSaving(false);
      setForceOverwriteOpen(false);
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
          message: mapDeploymentError(err, t).message,
        },
      }));
    } finally {
      setTesting(null);
    }
  }

  return (
    <SettingsPage narrow>
      {readOnly ||
      data?.secretsError === 'encrypted_no_key' ||
      data?.secretsError === 'unreadable' ? (
        <Stack gap={3}>
          {readOnly ? (
            <Alert
              variant="info"
              icon={Info}
              title={t('dataResidency.readOnly.title')}
              description={
                <>
                  {t('dataResidency.readOnly.before')}{' '}
                  <code>TALE_DEPLOYMENT_CONFIG_ADMINS</code>{' '}
                  {t('dataResidency.readOnly.after')}
                  {data?.email ? (
                    <>
                      {' '}
                      {t('dataResidency.readOnly.yourEmail', {
                        email: data.email,
                      })}
                    </>
                  ) : null}
                </>
              }
            />
          ) : null}
          {data?.secretsError === 'encrypted_no_key' ? (
            <Alert
              variant="warning"
              description={t('dataResidency.secretsEncryptedNoKey')}
            />
          ) : null}
          {data?.secretsError === 'unreadable' ? (
            <Alert
              variant="warning"
              description={t('dataResidency.secretsUnreadable')}
            />
          ) : null}
        </Stack>
      ) : null}

      <PgSection
        title={t('dataResidency.knowledge.title')}
        description={t('dataResidency.knowledge.description')}
        state={knowledge}
        setState={setKnowledge}
        secretMasked={
          secretState['dataStores.knowledgePostgres.password']?.masked
        }
        secretPresent={
          secretState['dataStores.knowledgePostgres.password']?.present
        }
        onTest={() => void runTest('knowledgePostgres')}
        testing={testing === 'knowledgePostgres'}
        testResult={testResults.knowledgePostgres}
        disabled={readOnly}
        note={<Alert description={t('dataResidency.knowledge.paradeDbNote')} />}
      />

      <PageSection
        title={t('dataResidency.storage.title')}
        description={t('dataResidency.storage.description')}
        action={
          <Switch
            label={t('dataResidency.storage.externalS3')}
            hideLabelOnMobile
            checked={storage.s3}
            disabled={readOnly}
            onCheckedChange={(checked) =>
              setStorage({ ...storage, s3: checked })
            }
          />
        }
      >
        {storage.s3 ? (
          <Stack gap={5}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t('dataResidency.storage.region')}
                value={storage.region}
                disabled={readOnly}
                onChange={(e) =>
                  setStorage({ ...storage, region: e.target.value })
                }
              />
              <Input
                label={t('dataResidency.storage.endpoint')}
                value={storage.endpoint}
                disabled={readOnly}
                onChange={(e) =>
                  setStorage({ ...storage, endpoint: e.target.value })
                }
              />
            </div>
            <Switch
              label={t('dataResidency.storage.forcePathStyle')}
              checked={storage.forcePathStyle}
              disabled={readOnly}
              onCheckedChange={(checked) =>
                setStorage({ ...storage, forcePathStyle: checked })
              }
            />
            <FormSection label={t('dataResidency.storage.bucketsLabel')}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('dataResidency.storage.bucket.files')}
                  value={storage.files}
                  disabled={readOnly}
                  onChange={(e) =>
                    setStorage({ ...storage, files: e.target.value })
                  }
                />
                <Input
                  label={t('dataResidency.storage.bucket.exports')}
                  value={storage.exports}
                  disabled={readOnly}
                  onChange={(e) =>
                    setStorage({ ...storage, exports: e.target.value })
                  }
                />
                <Input
                  label={t('dataResidency.storage.bucket.snapshotImports')}
                  value={storage.snapshotImports}
                  disabled={readOnly}
                  onChange={(e) =>
                    setStorage({ ...storage, snapshotImports: e.target.value })
                  }
                />
                <Input
                  label={t('dataResidency.storage.bucket.modules')}
                  value={storage.modules}
                  disabled={readOnly}
                  onChange={(e) =>
                    setStorage({ ...storage, modules: e.target.value })
                  }
                />
                <Input
                  label={t('dataResidency.storage.bucket.search')}
                  value={storage.search}
                  disabled={readOnly}
                  onChange={(e) =>
                    setStorage({ ...storage, search: e.target.value })
                  }
                />
              </div>
            </FormSection>
            <FormSection label={t('dataResidency.storage.credentialsLabel')}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('dataResidency.storage.accessKeyId')}
                  value={storage.accessKeyId}
                  disabled={readOnly}
                  onChange={(e) =>
                    setStorage({ ...storage, accessKeyId: e.target.value })
                  }
                  description={
                    secretState['dataStores.convexStorage.accessKeyId']?.masked
                      ? t('dataResidency.storage.accessKeyIdStoredHint', {
                          masked:
                            secretState['dataStores.convexStorage.accessKeyId']
                              .masked,
                        })
                      : t('dataResidency.storage.writeOnly')
                  }
                />
                <Input
                  label={t('dataResidency.storage.secretAccessKey')}
                  type="password"
                  value={storage.secretAccessKey}
                  disabled={readOnly}
                  onChange={(e) =>
                    setStorage({ ...storage, secretAccessKey: e.target.value })
                  }
                  description={t('dataResidency.storage.writeOnly')}
                />
              </div>
            </FormSection>
            <HStack gap={3} align="center" className="flex-wrap">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void runTest('convexStorage')}
                disabled={readOnly || testing === 'convexStorage'}
              >
                {testing === 'convexStorage'
                  ? t('dataResidency.testing')
                  : t('dataResidency.storage.testReachability')}
              </Button>
              <TestResultLine
                result={testResults.convexStorage}
                okLabel={t('dataResidency.storage.reachable')}
              />
            </HStack>
            <Alert
              variant="warning"
              description={t('dataResidency.storage.greenfieldWarning')}
            />
          </Stack>
        ) : (
          <p className="text-muted-foreground text-sm">
            {t('dataResidency.storage.localStorageNote')}
          </p>
        )}
      </PageSection>

      {/* Advanced Convex metadata DB — reuses the Postgres section chrome; its
          own header switch toggles `enabled`. Titled "(advanced)" rather than
          hidden behind a disclosure so it shares the rhythm of the sections
          above. */}
      <PgSection
        title={t('dataResidency.appDb.summary')}
        description={t('dataResidency.appDb.description')}
        state={appPg}
        setState={setAppPg}
        secretMasked={secretState['dataStores.appPostgres.password']?.masked}
        secretPresent={secretState['dataStores.appPostgres.password']?.present}
        onTest={() => void runTest('appPostgres')}
        testing={testing === 'appPostgres'}
        testResult={testResults.appPostgres}
        disabled={readOnly}
        showSslMode={false}
        note={
          <p className="text-muted-foreground text-xs">
            {t('dataResidency.appDb.databaseNameNote')}{' '}
            {t('dataResidency.appDb.sslModeNote')}
          </p>
        }
      />

      <Stack gap={4}>
        {error ? <Alert variant="destructive" description={error} /> : null}
        {savedOk && !isDirty ? (
          <Alert
            description={
              <>
                <strong>{t('dataResidency.saved.title')}</strong>{' '}
                {t('dataResidency.saved.runPrefix')}{' '}
                <code>docker compose restart convex</code>{' '}
                {t('dataResidency.saved.orPrefix')}{' '}
                <code>tale deploy --services convex</code>{' '}
                {t('dataResidency.saved.tail')}
              </>
            }
          />
        ) : null}

        <HStack gap={3} align="center" className="flex-wrap">
          <Button
            onClick={() => void onSave()}
            disabled={readOnly || saving || !isDirty}
          >
            {saving ? t('dataResidency.saving') : t('dataResidency.save')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setRestartConfirmOpen(true)}
            // Gate on a clean form: a restart applies the LAST-SAVED on-disk
            // config, so allowing it while dirty would silently bounce into a
            // config that differs from what's on screen.
            disabled={readOnly || restarting || isDirty}
            title={t('dataResidency.applyRestartTitle')}
          >
            {restarting
              ? t('dataResidency.restarting')
              : t('dataResidency.applyRestart')}
          </Button>
          {isDirty ? (
            <span className="text-muted-foreground text-sm">
              {t('dataResidency.applyRestartDirtyHint')}
            </span>
          ) : restartMsg ? (
            <span className="text-muted-foreground text-sm">{restartMsg}</span>
          ) : null}
        </HStack>
      </Stack>

      <ConfirmDialog
        open={restartConfirmOpen}
        onOpenChange={setRestartConfirmOpen}
        title={t('dataResidency.restartConfirm.title')}
        description={t('dataResidency.restartConfirm.description')}
        confirmText={t('dataResidency.restartConfirm.confirm')}
        isLoading={restarting}
        variant="destructive"
        onConfirm={() => void onRestart()}
      />

      <ConfirmDialog
        open={forceOverwriteOpen}
        onOpenChange={setForceOverwriteOpen}
        title={t('dataResidency.forceOverwrite.title')}
        description={t('dataResidency.forceOverwrite.description')}
        confirmText={t('dataResidency.forceOverwrite.confirm')}
        isLoading={saving}
        variant="destructive"
        onConfirm={() => void onForceOverwrite()}
      />
    </SettingsPage>
  );
}

export function DeploymentSettings() {
  const { t } = useT('settings');
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const query = useReadDeploymentConfig();

  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('deployment')} />;
  }

  // A failed read must not fall through to a blank, editable-looking default
  // form — that would imply "no overrides configured" when the truth is unknown.
  if (query.isError) {
    return (
      <SettingsPage narrow>
        <Alert
          variant="warning"
          description={t('dataResidency.errors.readFailed', {
            error: mapDeploymentError(query.error, t).message,
          })}
        />
      </SettingsPage>
    );
  }

  return (
    <Skeletonize loading={abilityLoading || query.isPending}>
      <DeploymentSettingsView data={query.data} />
    </Skeletonize>
  );
}
