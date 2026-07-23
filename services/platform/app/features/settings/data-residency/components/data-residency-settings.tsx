'use client';

/**
 * Unified data-residency settings.
 *
 * One page, two access levels of the SAME surface — not two pages:
 *
 *   - Deployment stores (knowledge database, file storage, and the advanced
 *     application database). Open to any organization admin to VIEW where the
 *     deployment keeps its data; editable only by an operator whose email is in
 *     the `TALE_DEPLOYMENT_CONFIG_ADMINS` allowlist (the read action returns
 *     `canEdit`). A non-operator admin sees these stores read-only with a stated
 *     reason — never a bare disabled control.
 *   - Organization object storage (BYO S3-compatible bucket). Editable by an org
 *     admin (`write orgSettings`); read-only with a stated reason otherwise. The
 *     per-org connection lives in `$TALE_CONFIG_DIR/<org>/object-storage/
 *     connection.json`, which stays the source of truth on disk.
 *
 * Read-only sections render the stored coordinates as native read-only fields
 * (conveyed to assistive tech, not by disabled/color alone) and the on/off state
 * as a status badge; write-only credentials are never shown to a viewer.
 *
 * Strings live under `settings.dataResidency.*` (deployment vocabulary +
 * `orgStorage.*` for the org section), plus `navigation.dataResidency`,
 * `metadata.dataResidency`, and `accessDenied.dataResidency` across en/de/fr
 * (de-CH inherits de). Code tokens (env vars, shell commands, bucket names) stay
 * English in every locale.
 *
 * `api.deployment.*` resolves after `convex codegen` (runs on dev/deploy).
 */

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Info } from 'lucide-react';
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useState,
} from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { useRegisterSettingsSecondaryAction } from '@/app/features/settings/components/settings-secondary-action-context';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { TestResultLine } from '@/app/features/settings/components/test-result-line';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { structuralEqual } from '@/lib/utils/structural-equal';

import { mapDeploymentError } from '../deployment-errors';
import {
  useDeleteOrgObjectStorageConnection,
  useRequestRestart,
  useSaveDeploymentConfig,
  useSaveDeploymentSecret,
  useSaveOrgObjectStorageConnection,
  useTestDeploymentConnection,
  useTestOrgObjectStorageConnection,
} from '../hooks/mutations';
import {
  useOrgObjectStorageConnection,
  useReadDeploymentConfig,
} from '../hooks/queries';
import { mapOrgResidencyError } from '../org-residency-errors';

const SSL_MODES = ['disable', 'prefer', 'require', 'verify-ca', 'verify-full'];

/** Placeholder for an unset optional value in a read-only field (never blank). */
const READ_ONLY_EMPTY = '—';

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

/**
 * A stored value the current caller cannot edit, rendered as a native
 * read-only field so its label and value are exposed to assistive tech (the
 * Input auto-selects its borderless read-only variant). Optional values that
 * are unset show an em-dash rather than an empty box.
 */
function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <Input label={label} value={value || READ_ONLY_EMPTY} readOnly />;
}

/** The on/off state of a store, as a scannable status pill. */
function StatusBadge({
  enabled,
  onLabel,
  offLabel,
}: {
  enabled: boolean;
  onLabel: string;
  offLabel: string;
}) {
  return (
    <Badge variant={enabled ? 'blue' : 'slate'} dot>
      {enabled ? onLabel : offLabel}
    </Badge>
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
function DeploymentStoresView({
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

  // Register Save and Apply & restart in the shared settings header. Always
  // register both (fixed-size array so effect deps never change length);
  // read-only viewers gate via `disabled` rather than omitting the buttons.
  useRegisterSettingsSecondaryAction([
    {
      label: t('dataResidency.save'),
      loadingLabel: t('dataResidency.saving'),
      onClick: () => void onSave(),
      disabled: readOnly || saving || !isDirty,
      loading: saving,
    },
    {
      label: t('dataResidency.applyRestart'),
      loadingLabel: t('dataResidency.restarting'),
      onClick: () => setRestartConfirmOpen(true),
      disabled: readOnly || restarting || isDirty,
      loading: restarting,
      title: t('dataResidency.applyRestartTitle'),
      variant: 'secondary',
    },
  ]);

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
    <>
      {/* Save / restart status — inline at the top so they're visible without
          scrolling. */}
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
              icon={Info}
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
        className="border-border border-t pt-8"
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
        className="border-border border-t pt-8"
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
    </>
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

/** Masked read of the org's object-storage connection. */
interface StorageView {
  configured: boolean;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  bucket?: string;
  prefix?: string;
  hasCredentials?: boolean;
}

/** Probe result shape (the actions declare `returns: v.any()`). */
interface StorageProbeResult {
  ok: boolean;
  error?: string;
}

type OrgStorageForm = {
  enabled: boolean;
  region: string;
  endpoint: string;
  forcePathStyle: boolean;
  bucket: string;
  prefix: string;
  accessKeyId: string; // write-only
  secretAccessKey: string; // write-only
};

/**
 * Per-section outcome banner. `saved`/`cleared` render only while the form
 * matches its baseline (editing hides them without an explicit clear);
 * `error` is cleared on the next edit.
 */
type SectionFeedback =
  | { kind: 'saved' }
  | { kind: 'cleared' }
  | { kind: 'error'; message: string }
  | null;

type TestResult = { ok: boolean; message?: string } | undefined;

const emptyOrgStorage = (): OrgStorageForm => ({
  enabled: false,
  region: '',
  endpoint: '',
  forcePathStyle: false,
  bucket: '',
  prefix: '',
  accessKeyId: '',
  secretAccessKey: '',
});

function orgStorageFromView(view: StorageView | undefined): OrgStorageForm {
  if (!view?.configured) return emptyOrgStorage();
  return {
    enabled: true,
    region: view.region ?? '',
    endpoint: view.endpoint ?? '',
    forcePathStyle: Boolean(view.forcePathStyle),
    bucket: view.bucket ?? '',
    prefix: view.prefix ?? '',
    accessKeyId: '',
    secretAccessKey: '',
  };
}

/** Feedback banners + baseline-gated success/cleared notes for one section. */
function SectionFeedbackView({
  feedback,
  dirty,
  savedText,
  clearedText,
}: {
  feedback: SectionFeedback;
  dirty: boolean;
  savedText: string;
  clearedText: string;
}) {
  if (!feedback) return null;
  if (feedback.kind === 'error') {
    return <Alert variant="destructive" description={feedback.message} />;
  }
  if (dirty) return null;
  return (
    <Alert description={feedback.kind === 'saved' ? savedText : clearedText} />
  );
}

/**
 * The organization's BYO object-storage connection. Editable by an org admin
 * (`write orgSettings`); a member without that capability sees the stored
 * coordinates read-only with a stated reason. Backed by its own per-org admin
 * actions, so Save / Test / Remove live inside the section.
 */
function OrgStorageSection({
  organizationId,
  view,
  readError,
  readOnly,
  className,
}: {
  organizationId: string;
  view: StorageView | undefined;
  readError?: string;
  readOnly: boolean;
  className?: string;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const baseline = orgStorageFromView(view);
  const [form, setFormRaw] = useState(baseline);
  const [feedback, setFeedback] = useState<SectionFeedback>(null);
  const [testResult, setTestResult] = useState<TestResult>(undefined);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const save = useSaveOrgObjectStorageConnection(organizationId);
  const remove = useDeleteOrgObjectStorageConnection(organizationId);
  const test = useTestOrgObjectStorageConnection();

  const viewKey = JSON.stringify(view ?? null);
  useEffect(() => {
    setFormRaw(orgStorageFromView(view));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const dirty = !structuralEqual(form, baseline);
  const busy = save.isPending || remove.isPending;
  // Test with EITHER a freshly entered key pair OR — once keys are stored —
  // no keys at all (the server reuses the sidecar). This is what makes
  // "Save, then Test" work: Save clears the write-only fields, so a follow-up
  // Test carries no keys but must still validate the stored connection. A
  // half-entered pair (one field filled) stays off — the probe needs both.
  const bothKeysEntered =
    form.accessKeyId.length > 0 && form.secretAccessKey.length > 0;
  const noKeysEntered =
    form.accessKeyId.length === 0 && form.secretAccessKey.length === 0;
  const canTest =
    bothKeysEntered || (noKeysEntered && (view?.hasCredentials ?? false));

  const onLabel = t('dataResidency.storage.externalS3');
  const offLabel = t('dataResidency.orgStorage.statusDefault');

  function setForm(next: OrgStorageForm) {
    if (feedback?.kind === 'error') setFeedback(null);
    setTestResult(undefined);
    setFormRaw(next);
  }

  function buildCoordinates() {
    return {
      organizationId,
      region: form.region.trim(),
      ...(form.endpoint.trim() ? { endpoint: form.endpoint.trim() } : {}),
      forcePathStyle: form.forcePathStyle,
      bucket: form.bucket.trim(),
      ...(form.prefix.trim() ? { prefix: form.prefix.trim() } : {}),
    };
  }

  async function onSave() {
    setFeedback(null);
    try {
      await save.mutateAsync({
        ...buildCoordinates(),
        // Both blank leaves the stored key pair untouched (edit of the bucket
        // coordinates); the server enforces pair-or-none and first-time keys.
        ...(form.accessKeyId ? { accessKeyId: form.accessKeyId } : {}),
        ...(form.secretAccessKey
          ? { secretAccessKey: form.secretAccessKey }
          : {}),
      });
      setFormRaw((f) => ({ ...f, accessKeyId: '', secretAccessKey: '' }));
      setFeedback({ kind: 'saved' });
    } catch (err) {
      setFeedback({ kind: 'error', message: mapOrgResidencyError(err, t) });
    }
  }

  async function onTest() {
    setTestResult(undefined);
    try {
      const res: StorageProbeResult = await test.mutateAsync({
        ...buildCoordinates(),
        // Omit blank keys so the server reuses the stored sidecar (canTest only
        // allows a blank-field test when keys are already stored); a typed pair
        // is sent verbatim to probe it before saving.
        ...(form.accessKeyId ? { accessKeyId: form.accessKeyId } : {}),
        ...(form.secretAccessKey
          ? { secretAccessKey: form.secretAccessKey }
          : {}),
      });
      setTestResult({ ok: res.ok, message: res.error || undefined });
    } catch (err) {
      setTestResult({ ok: false, message: mapOrgResidencyError(err, t) });
    }
  }

  async function onClear() {
    try {
      await remove.mutateAsync({ organizationId });
      setTestResult(undefined);
      setFeedback({ kind: 'cleared' });
    } catch (err) {
      setFeedback({ kind: 'error', message: mapOrgResidencyError(err, t) });
    } finally {
      setClearConfirmOpen(false);
    }
  }

  function onToggle(checked: boolean) {
    if (checked) {
      setForm({ ...form, enabled: true });
      return;
    }
    if (baseline.enabled) {
      setClearConfirmOpen(true);
      return;
    }
    setForm(emptyOrgStorage());
  }

  return (
    <SettingsSection
      className={className}
      title={t('dataResidency.orgStorage.title')}
      description={t('dataResidency.orgStorage.description')}
      action={
        readError ? undefined : readOnly ? (
          <StatusBadge
            enabled={form.enabled}
            onLabel={onLabel}
            offLabel={offLabel}
          />
        ) : (
          <HStack gap={2} align="center">
            <StatusBadge
              enabled={form.enabled}
              onLabel={onLabel}
              offLabel={offLabel}
            />
            <Switch
              aria-label={onLabel}
              checked={form.enabled}
              disabled={busy}
              onCheckedChange={onToggle}
            />
          </HStack>
        )
      }
    >
      {readError ? (
        <Alert
          variant="warning"
          description={t('dataResidency.orgStorage.errors.readFailed', {
            error: readError,
          })}
        />
      ) : readOnly ? (
        <>
          <Alert
            variant="info"
            icon={Info}
            description={
              <>
                <strong>{t('dataResidency.readOnly.title')}</strong>{' '}
                {t('dataResidency.orgStorage.readOnlyBody')}
              </>
            }
          />
          {form.enabled ? (
            <Stack gap={5}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ReadOnlyField
                  label={t('dataResidency.storage.region')}
                  value={form.region}
                />
                <ReadOnlyField
                  label={t('dataResidency.storage.endpoint')}
                  value={form.endpoint}
                />
                <ReadOnlyField
                  label={t('dataResidency.orgStorage.bucket')}
                  value={form.bucket}
                />
                <ReadOnlyField
                  label={t('dataResidency.orgStorage.prefix')}
                  value={form.prefix}
                />
                <ReadOnlyField
                  label={t('dataResidency.storage.forcePathStyle')}
                  value={
                    form.forcePathStyle
                      ? tCommon('status.enabled')
                      : tCommon('status.disabled')
                  }
                />
              </div>
              <p className="text-muted-foreground text-xs">
                {t('dataResidency.orgStorage.note')}
              </p>
            </Stack>
          ) : null}
        </>
      ) : (
        <>
          <SectionFeedbackView
            feedback={feedback}
            dirty={dirty}
            savedText={t('dataResidency.orgStorage.saved')}
            clearedText={t('dataResidency.orgStorage.cleared')}
          />
          {form.enabled ? (
            <Stack gap={5}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('dataResidency.storage.region')}
                  value={form.region}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                />
                <Input
                  label={t('dataResidency.storage.endpoint')}
                  value={form.endpoint}
                  disabled={busy}
                  onChange={(e) =>
                    setForm({ ...form, endpoint: e.target.value })
                  }
                />
                <Input
                  label={t('dataResidency.orgStorage.bucket')}
                  value={form.bucket}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, bucket: e.target.value })}
                />
                <Input
                  label={t('dataResidency.orgStorage.prefix')}
                  value={form.prefix}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, prefix: e.target.value })}
                  description={t('dataResidency.orgStorage.prefixHint')}
                />
              </div>
              <Switch
                label={t('dataResidency.storage.forcePathStyle')}
                checked={form.forcePathStyle}
                disabled={busy}
                onCheckedChange={(checked) =>
                  setForm({ ...form, forcePathStyle: checked })
                }
              />
              <FormSection
                label={t('dataResidency.storage.credentialsLabel')}
                description={t('dataResidency.orgStorage.credentialsHint')}
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    label={t('dataResidency.storage.accessKeyId')}
                    value={form.accessKeyId}
                    disabled={busy}
                    onChange={(e) =>
                      setForm({ ...form, accessKeyId: e.target.value })
                    }
                    description={
                      view?.hasCredentials
                        ? t('dataResidency.password.storedNoPreviewHint')
                        : t('dataResidency.storage.writeOnly')
                    }
                  />
                  <Input
                    label={t('dataResidency.storage.secretAccessKey')}
                    type="password"
                    value={form.secretAccessKey}
                    disabled={busy}
                    onChange={(e) =>
                      setForm({ ...form, secretAccessKey: e.target.value })
                    }
                    description={
                      view?.hasCredentials
                        ? t('dataResidency.password.storedNoPreviewHint')
                        : t('dataResidency.storage.writeOnly')
                    }
                  />
                </div>
              </FormSection>
              <HStack gap={3} align="center" className="flex-wrap">
                <Button
                  size="sm"
                  onClick={() => void onSave()}
                  disabled={busy || !dirty}
                >
                  {save.isPending
                    ? t('dataResidency.saving')
                    : t('dataResidency.save')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void onTest()}
                  disabled={busy || test.isPending || !canTest}
                >
                  {test.isPending
                    ? t('dataResidency.testing')
                    : t('dataResidency.testConnection')}
                </Button>
                <TestResultLine
                  result={testResult}
                  okLabel={t('dataResidency.orgStorage.verified')}
                />
              </HStack>
              <Alert
                description={t('dataResidency.orgStorage.corsNote', {
                  origin: window.location.origin,
                })}
              />
              <p className="text-muted-foreground text-xs">
                {t('dataResidency.orgStorage.note')}
              </p>
            </Stack>
          ) : // Off = deployment default: the status pill already says so.
          null}
        </>
      )}

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t('dataResidency.orgStorage.clearConfirm.title')}
        description={t('dataResidency.orgStorage.clearConfirm.description')}
        confirmText={t('dataResidency.orgStorage.clearConfirm.confirm')}
        isLoading={remove.isPending}
        variant="destructive"
        onConfirm={() => void onClear()}
      />
    </SettingsSection>
  );
}

export function DataResidencySettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const deploymentQuery = useReadDeploymentConfig();
  const storageQuery = useOrgObjectStorageConnection(organizationId);

  // Viewing is open to any organization admin (`read orgSettings`) — the same
  // gate the deployment read enforces server-side. Editing each store is a
  // finer capability resolved per section: deployment stores need the operator
  // allowlist (`canEdit` from the read); org storage needs `write orgSettings`.
  if (!abilityLoading && ability.cannot('read', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('dataResidency')} />;
  }

  const canWriteOrg = !abilityLoading && ability.can('write', 'orgSettings');

  // A failed read must not fall through to a blank, default-looking form — that
  // would imply "nothing configured" when the truth is unknown. Each group
  // reports its own read failure inline.
  const deploymentReadError = deploymentQuery.isError
    ? mapDeploymentError(deploymentQuery.error, t).message
    : undefined;
  const storageReadError = storageQuery.isError
    ? mapOrgResidencyError(storageQuery.error, t)
    : undefined;

  return (
    <Skeletonize
      loading={
        abilityLoading || deploymentQuery.isPending || storageQuery.isPending
      }
    >
      <SettingsPage>
        <DeploymentStoresView
          data={deploymentQuery.data}
          readError={deploymentReadError}
        />
        <OrgStorageSection
          className="border-border border-t pt-8"
          organizationId={organizationId}
          view={storageQuery.data}
          readError={storageReadError}
          readOnly={!canWriteOrg}
        />
      </SettingsPage>
    </Skeletonize>
  );
}
