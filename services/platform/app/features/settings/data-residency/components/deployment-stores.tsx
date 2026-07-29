'use client';

/**
 * The deployment-level stores group of the data-residency page: knowledge
 * database, file storage, and the advanced application database. Open to any
 * organization admin to VIEW where the deployment keeps its data; editable
 * only by an operator whose email is in the `TALE_DEPLOYMENT_CONFIG_ADMINS`
 * allowlist (the read action returns `canEdit`). A non-operator admin sees
 * these stores read-only with a stated reason — never a bare disabled control.
 *
 * Deliberately NOT on the page's editor contract: its Save must be followed by
 * an explicit "Apply & restart" (the config lands in containers, not in the
 * app), so it registers its own header actions — labelled "Save deployment"
 * and placed `leading` so they never collide with the org sections' plain
 * Discard/Save cluster to their right.
 */

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useState,
} from 'react';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { useRegisterSettingsSecondaryAction } from '@/app/features/settings/components/settings-secondary-action-context';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { TestResultLine } from '@/app/features/settings/components/test-result-line';
import { useT } from '@/lib/i18n/client';
import { structuralEqual } from '@/lib/utils/structural-equal';

import { mapDeploymentError } from '../deployment-errors';
import {
  useRequestRestart,
  useSaveDeploymentConfig,
  useSaveDeploymentSecret,
  useTestDeploymentConnection,
} from '../hooks/mutations';
import { ReadOnlyField, StatusBadge } from './residency-chrome';

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

export type DeploymentReadData = {
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

/**
 * The deployment group's header actions, mounted ONLY for allowlisted
 * operators — a non-operator never sees buttons they can never use (the same
 * doctrine that hides the org sections' Save cluster from read-only viewers).
 * Registration lives in its own conditionally-mounted component because the
 * registrar hook requires a render-stable action count; unmounting clears the
 * slot via the hook's own cleanup.
 *
 * Both actions sit `leading` (before the org sections' Discard/Save cluster)
 * and the Save is labelled "Save deployment" — two plain "Save" buttons side
 * by side would be indistinguishable.
 */
function DeploymentHeaderActions({
  onSave,
  onRestartClick,
  saving,
  restarting,
  isDirty,
}: {
  onSave: () => void;
  onRestartClick: () => void;
  saving: boolean;
  restarting: boolean;
  isDirty: boolean;
}) {
  const { t } = useT('settings');
  useRegisterSettingsSecondaryAction([
    {
      label: t('dataResidency.saveDeployment'),
      loadingLabel: t('dataResidency.saving'),
      onClick: onSave,
      disabled: saving || !isDirty,
      loading: saving,
      placement: 'leading',
    },
    {
      label: t('dataResidency.applyRestart'),
      loadingLabel: t('dataResidency.restarting'),
      onClick: onRestartClick,
      disabled: restarting || isDirty,
      loading: restarting,
      title: t('dataResidency.applyRestartTitle'),
      variant: 'secondary',
      placement: 'leading',
    },
  ]);
  return null;
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
  readOnly,
  note,
  showSslMode = true,
  className,
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
  /** The caller may only view this store (not in the deployment-editor allowlist). */
  readOnly: boolean;
  /** Contextual footnote shown below the fields while the section is enabled. */
  note?: ReactNode;
  /**
   * Whether to render the SSL-mode control. Off for the app (Convex metadata)
   * DB: its postgres-v5 driver derives the database from INSTANCE_NAME and
   * rejects a `?sslmode=` URL, so the boot path cannot honor a chosen mode —
   * offering the control would promise a guarantee we can't deliver.
   */
  showSslMode?: boolean;
  /** Forwarded to the underlying section root (e.g. a divider border). */
  className?: string;
}) {
  const { t } = useT('settings');
  const onLabel = t('dataResidency.externalPostgres');
  const offLabel = t('dataResidency.status.builtIn');
  return (
    <SettingsSection
      className={className}
      title={title}
      description={description}
      action={
        // Read-only viewers get the status pill alone (state as text); editors
        // get the pill plus the switch that toggles it (its accessible name
        // comes from `aria-label`, since the pill is visual).
        readOnly ? (
          <StatusBadge
            enabled={state.enabled}
            onLabel={onLabel}
            offLabel={offLabel}
          />
        ) : (
          <HStack gap={2} align="center">
            <StatusBadge
              enabled={state.enabled}
              onLabel={onLabel}
              offLabel={offLabel}
            />
            <Switch
              aria-label={onLabel}
              checked={state.enabled}
              onCheckedChange={(checked) =>
                setState({ ...state, enabled: checked })
              }
            />
          </HStack>
        )
      }
    >
      {state.enabled ? (
        readOnly ? (
          // Viewer: the stored coordinates as read-only fields. Write-only
          // credentials are never shown, so no password field appears.
          <Stack gap={4}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ReadOnlyField
                label={t('dataResidency.field.host')}
                value={state.host}
              />
              <ReadOnlyField
                label={t('dataResidency.field.port')}
                value={state.port}
              />
              <ReadOnlyField
                label={t('dataResidency.field.database')}
                value={state.database}
              />
              <ReadOnlyField
                label={t('dataResidency.field.user')}
                value={state.user}
              />
              {showSslMode ? (
                <ReadOnlyField
                  label={t('dataResidency.field.sslMode')}
                  value={state.sslmode}
                />
              ) : null}
            </div>
            {note}
          </Stack>
        ) : (
          <Stack gap={4}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t('dataResidency.field.host')}
                value={state.host}
                onChange={(e) => setState({ ...state, host: e.target.value })}
              />
              <Input
                label={t('dataResidency.field.port')}
                type="number"
                value={state.port}
                onChange={(e) => setState({ ...state, port: e.target.value })}
              />
              <Input
                label={t('dataResidency.field.database')}
                value={state.database}
                onChange={(e) =>
                  setState({ ...state, database: e.target.value })
                }
              />
              <Input
                label={t('dataResidency.field.user')}
                value={state.user}
                onChange={(e) => setState({ ...state, user: e.target.value })}
              />
              {showSslMode ? (
                <Select
                  label={t('dataResidency.field.sslMode')}
                  value={state.sslmode}
                  onValueChange={(v) => setState({ ...state, sslmode: v })}
                  options={SSL_MODES.map((m) => ({ value: m, label: m }))}
                />
              ) : null}
              <Input
                label={t('dataResidency.field.password')}
                type="password"
                value={state.password}
                onChange={(e) =>
                  setState({ ...state, password: e.target.value })
                }
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
                disabled={testing}
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
        )
      ) : // Off = built-in: the status pill in the header already says so, so
      // the body stays empty rather than repeating it as a grey sentence.
      null}
    </SettingsSection>
  );
}

/**
 * The deployment-level stores group: knowledge database, file storage, and the
 * advanced application database. `data.canEdit` gates editing; a viewer sees
 * every store read-only with the allowlist reason stated up top. When the read
 * itself fails, the group shows a single warning in place of the stores.
 */
export function DeploymentStoresView({
  data,
  readError,
}: {
  data: DeploymentReadData | undefined;
  readError?: string;
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

  // A failed read must not fall through to a blank, editable-looking default
  // form — that would imply "no overrides configured" when the truth is unknown.
  if (readError) {
    return (
      <Alert
        variant="warning"
        description={t('dataResidency.errors.readFailed', { error: readError })}
      />
    );
  }

  return (
    // One wrapper (not a fragment) so the page's section-divider rule draws
    // the group's leading hairline ABOVE its banners, and the internal
    // section-sibling arm of the same rule separates the stores within.
    <Stack gap={8}>
      {canEdit ? (
        <DeploymentHeaderActions
          onSave={() => void onSave()}
          onRestartClick={() => setRestartConfirmOpen(true)}
          saving={saving}
          restarting={restarting}
          isDirty={isDirty}
        />
      ) : null}
      {/* Save / restart status — inline at the top of the group so they're
          visible next to the sections they concern. */}
      {error || (savedOk && !isDirty) || restartMsg ? (
        <Stack gap={3}>
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
          {restartMsg ? <Alert description={restartMsg} /> : null}
        </Stack>
      ) : null}

      {readOnly ||
      data?.secretsError === 'encrypted_no_key' ||
      data?.secretsError === 'unreadable' ? (
        <Stack gap={3}>
          {readOnly ? (
            // The reason lives in the description (a `<strong>` lead), not the
            // Alert's title slot — that renders a fixed <h5> and would skip
            // heading levels under the section <h2>s below.
            <Alert
              variant="info"
              description={
                <>
                  <strong>{t('dataResidency.readOnly.title')}</strong>{' '}
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
        readOnly={readOnly}
        note={<Alert description={t('dataResidency.knowledge.paradeDbNote')} />}
      />

      <DeploymentStorageSection
        storage={storage}
        setStorage={setStorage}
        secretState={secretState}
        onTest={() => void runTest('convexStorage')}
        testing={testing === 'convexStorage'}
        testResult={testResults.convexStorage}
        readOnly={readOnly}
      />

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
        readOnly={readOnly}
        showSslMode={false}
        note={
          <p className="text-muted-foreground text-xs">
            {t('dataResidency.appDb.databaseNameNote')}{' '}
            {t('dataResidency.appDb.sslModeNote')}
          </p>
        }
      />

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
    </Stack>
  );
}

/** Deployment-level object storage (Convex blob store). */
function DeploymentStorageSection({
  storage,
  setStorage,
  secretState,
  onTest,
  testing,
  testResult,
  readOnly,
  className,
}: {
  storage: StorageForm;
  setStorage: (next: StorageForm) => void;
  secretState: Record<string, { present: boolean; masked?: string }>;
  onTest: () => void;
  testing: boolean;
  testResult?: { ok: boolean; message?: string };
  readOnly: boolean;
  className?: string;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const onLabel = t('dataResidency.storage.externalS3');
  const offLabel = t('dataResidency.storage.localLabel');
  return (
    <SettingsSection
      className={className}
      title={t('dataResidency.storage.title')}
      description={t('dataResidency.storage.description')}
      action={
        readOnly ? (
          <StatusBadge
            enabled={storage.s3}
            onLabel={onLabel}
            offLabel={offLabel}
          />
        ) : (
          <HStack gap={2} align="center">
            <StatusBadge
              enabled={storage.s3}
              onLabel={onLabel}
              offLabel={offLabel}
            />
            <Switch
              aria-label={onLabel}
              checked={storage.s3}
              onCheckedChange={(checked) =>
                setStorage({ ...storage, s3: checked })
              }
            />
          </HStack>
        )
      }
    >
      {!storage.s3 ? null : readOnly ? ( // Off = local volume: the header status pill already says so.
        <Stack gap={5}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ReadOnlyField
              label={t('dataResidency.storage.region')}
              value={storage.region}
            />
            <ReadOnlyField
              label={t('dataResidency.storage.endpoint')}
              value={storage.endpoint}
            />
            <ReadOnlyField
              label={t('dataResidency.storage.forcePathStyle')}
              value={
                storage.forcePathStyle
                  ? tCommon('status.enabled')
                  : tCommon('status.disabled')
              }
            />
          </div>
          <FormSection label={t('dataResidency.storage.bucketsLabel')}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ReadOnlyField
                label={t('dataResidency.storage.bucket.files')}
                value={storage.files}
              />
              <ReadOnlyField
                label={t('dataResidency.storage.bucket.exports')}
                value={storage.exports}
              />
              <ReadOnlyField
                label={t('dataResidency.storage.bucket.snapshotImports')}
                value={storage.snapshotImports}
              />
              <ReadOnlyField
                label={t('dataResidency.storage.bucket.modules')}
                value={storage.modules}
              />
              <ReadOnlyField
                label={t('dataResidency.storage.bucket.search')}
                value={storage.search}
              />
            </div>
          </FormSection>
        </Stack>
      ) : (
        <Stack gap={5}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={t('dataResidency.storage.region')}
              value={storage.region}
              onChange={(e) =>
                setStorage({ ...storage, region: e.target.value })
              }
            />
            <Input
              label={t('dataResidency.storage.endpoint')}
              value={storage.endpoint}
              onChange={(e) =>
                setStorage({ ...storage, endpoint: e.target.value })
              }
            />
          </div>
          <Switch
            label={t('dataResidency.storage.forcePathStyle')}
            checked={storage.forcePathStyle}
            onCheckedChange={(checked) =>
              setStorage({ ...storage, forcePathStyle: checked })
            }
          />
          <FormSection label={t('dataResidency.storage.bucketsLabel')}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t('dataResidency.storage.bucket.files')}
                value={storage.files}
                onChange={(e) =>
                  setStorage({ ...storage, files: e.target.value })
                }
              />
              <Input
                label={t('dataResidency.storage.bucket.exports')}
                value={storage.exports}
                onChange={(e) =>
                  setStorage({ ...storage, exports: e.target.value })
                }
              />
              <Input
                label={t('dataResidency.storage.bucket.snapshotImports')}
                value={storage.snapshotImports}
                onChange={(e) =>
                  setStorage({ ...storage, snapshotImports: e.target.value })
                }
              />
              <Input
                label={t('dataResidency.storage.bucket.modules')}
                value={storage.modules}
                onChange={(e) =>
                  setStorage({ ...storage, modules: e.target.value })
                }
              />
              <Input
                label={t('dataResidency.storage.bucket.search')}
                value={storage.search}
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
              onClick={onTest}
              disabled={testing}
            >
              {testing
                ? t('dataResidency.testing')
                : t('dataResidency.storage.testReachability')}
            </Button>
            <TestResultLine
              result={testResult}
              okLabel={t('dataResidency.storage.reachable')}
            />
          </HStack>
          <Alert
            variant="warning"
            description={t('dataResidency.storage.greenfieldWarning')}
          />
        </Stack>
      )}
    </SettingsSection>
  );
}
