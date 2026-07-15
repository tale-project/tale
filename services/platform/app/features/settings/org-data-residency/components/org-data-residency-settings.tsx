'use client';

/**
 * Organization-level data-residency settings (org admin).
 *
 * Lets an org admin point THIS organization's knowledge database (BYO
 * Postgres) and object storage (BYO S3-compatible bucket) at infrastructure
 * the org provides — UI parity with the per-org JSON config files
 * (`$TALE_CONFIG_DIR/<org>/{knowledge,object-storage}/connection.json`),
 * which stay the source of truth on disk.
 *
 * Mirrors the deployment-level panel's idioms (`deployment-settings.tsx`):
 * `SettingsSection` chrome with a status pill + enable switch, the shared
 * `Input`/`Select`/`Switch` grid, write-only secret fields, stale-feedback
 * clearing, and baseline reset when a fresh read lands. Unlike the deployment
 * file (one config, one Save), each section here is backed by its own pair of
 * per-org admin actions, so Save / Test / Remove live per section.
 *
 * Strings live in `settings.orgDataResidency.*` (org-specific copy) and reuse
 * `settings.dataResidency.*` for the field vocabulary shared with the
 * deployment panel. Gated on `write orgSettings` — the same CASL capability
 * the backend actions enforce.
 */

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { useEffect, useState } from 'react';

import { AccessDenied } from '@/app/components/layout/access-denied';
import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import { FormSection } from '@/app/components/ui/forms/form-section';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import { SettingsPage } from '@/app/features/settings/components/settings-page';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { TestResultLine } from '@/app/features/settings/components/test-result-line';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { useT } from '@/lib/i18n/client';
import { structuralEqual } from '@/lib/utils/structural-equal';

import {
  useDeleteOrgKnowledgeConnection,
  useDeleteOrgObjectStorageConnection,
  useSaveOrgKnowledgeConnection,
  useSaveOrgObjectStorageConnection,
  useTestOrgKnowledgeConnection,
  useTestOrgObjectStorageConnection,
} from '../hooks/mutations';
import {
  useOrgKnowledgeConnection,
  useOrgObjectStorageConnection,
} from '../hooks/queries';
import { mapOrgResidencyError } from '../org-residency-errors';

const SSL_MODES = [
  'disable',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
] as const;
type SslMode = (typeof SSL_MODES)[number];

function isSslMode(value: string): value is SslMode {
  return (SSL_MODES as readonly string[]).includes(value);
}

/** Masked read of the org's knowledge connection (mirrors the action's return). */
interface KnowledgeView {
  configured: boolean;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  sslmode?: SslMode;
  hasPassword?: boolean;
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

/** Probe result shapes (the actions declare `returns: v.any()`). */
interface KnowledgeProbeResult {
  ok: boolean;
  error?: string;
  hint?: string;
}
interface StorageProbeResult {
  ok: boolean;
  error?: string;
}

type PgForm = {
  enabled: boolean;
  host: string;
  port: string;
  database: string;
  user: string;
  sslmode: SslMode;
  password: string; // write-only; blank = keep stored
};

type StorageForm = {
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

const emptyPg = (): PgForm => ({
  enabled: false,
  host: '',
  port: '5432',
  database: '',
  user: '',
  sslmode: 'require',
  password: '',
});

function pgFromView(view: KnowledgeView | undefined): PgForm {
  if (!view?.configured) return emptyPg();
  return {
    enabled: true,
    host: view.host ?? '',
    port: String(view.port ?? 5432),
    database: view.database ?? '',
    user: view.user ?? '',
    sslmode: view.sslmode ?? 'require',
    password: '',
  };
}

const emptyStorage = (): StorageForm => ({
  enabled: false,
  region: '',
  endpoint: '',
  forcePathStyle: false,
  bucket: '',
  prefix: '',
  accessKeyId: '',
  secretAccessKey: '',
});

function storageFromView(view: StorageView | undefined): StorageForm {
  if (!view?.configured) return emptyStorage();
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

/** Section chrome shared by both stores: status pill + enable switch. */
function SectionToggle({
  enabledLabel,
  enabled,
  disabled,
  onToggle,
}: {
  enabledLabel: string;
  enabled: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const { t } = useT('settings');
  return (
    <HStack gap={2} align="center">
      <Badge variant={enabled ? 'blue' : 'slate'} dot>
        {enabled ? enabledLabel : t('orgDataResidency.statusDefault')}
      </Badge>
      <Switch
        aria-label={enabledLabel}
        checked={enabled}
        disabled={disabled}
        onCheckedChange={onToggle}
      />
    </HStack>
  );
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

function KnowledgeSection({
  organizationId,
  view,
  readError,
}: {
  organizationId: string;
  view: KnowledgeView | undefined;
  readError?: string;
}) {
  const { t } = useT('settings');
  const baseline = pgFromView(view);
  const [form, setFormRaw] = useState(baseline);
  const [feedback, setFeedback] = useState<SectionFeedback>(null);
  const [testResult, setTestResult] = useState<TestResult>(undefined);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const save = useSaveOrgKnowledgeConnection(organizationId);
  const remove = useDeleteOrgKnowledgeConnection(organizationId);
  const test = useTestOrgKnowledgeConnection();

  // Re-baseline when a fresh read lands (after a save/remove invalidates the
  // query) — keyed on content, not object identity, so an identical refetch
  // never wipes in-progress edits.
  const viewKey = JSON.stringify(view ?? null);
  useEffect(() => {
    setFormRaw(pgFromView(view));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const dirty = !structuralEqual(form, baseline);
  const busy = save.isPending || remove.isPending;

  // Editing clears a stale error and the now-outdated test result.
  function setForm(next: PgForm) {
    if (feedback?.kind === 'error') setFeedback(null);
    setTestResult(undefined);
    setFormRaw(next);
  }

  function buildArgs() {
    return {
      organizationId,
      host: form.host.trim(),
      port: Number(form.port) || 5432,
      database: form.database.trim(),
      user: form.user.trim(),
      sslmode: form.sslmode,
      // Blank keeps any stored password (write-only field, like the
      // deployment panel) — omit rather than send `''`, which would remove it.
      ...(form.password ? { password: form.password } : {}),
    };
  }

  async function onSave() {
    setFeedback(null);
    try {
      await save.mutateAsync(buildArgs());
      setFormRaw((f) => ({ ...f, password: '' }));
      setFeedback({ kind: 'saved' });
    } catch (err) {
      setFeedback({ kind: 'error', message: mapOrgResidencyError(err, t) });
    }
  }

  async function onTest() {
    setTestResult(undefined);
    try {
      const res: KnowledgeProbeResult = await test.mutateAsync(buildArgs());
      setTestResult({
        ok: res.ok,
        message: res.error || res.hint || undefined,
      });
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
    // Turning OFF a connection that exists on disk is destructive — confirm
    // before removing; the switch stays on until the removal succeeds.
    if (baseline.enabled) {
      setClearConfirmOpen(true);
      return;
    }
    setForm(emptyPg());
  }

  return (
    <SettingsSection
      title={t('orgDataResidency.knowledge.title')}
      description={t('orgDataResidency.knowledge.description')}
      action={
        readError ? undefined : (
          <SectionToggle
            enabledLabel={t('dataResidency.externalPostgres')}
            enabled={form.enabled}
            disabled={busy}
            onToggle={onToggle}
          />
        )
      }
    >
      {readError ? (
        <Alert
          variant="warning"
          description={t('orgDataResidency.errors.readFailed', {
            error: readError,
          })}
        />
      ) : (
        <>
          <SectionFeedbackView
            feedback={feedback}
            dirty={dirty}
            savedText={t('orgDataResidency.knowledge.saved')}
            clearedText={t('orgDataResidency.knowledge.cleared')}
          />
          {form.enabled ? (
            <Stack gap={4}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label={t('dataResidency.field.host')}
                  value={form.host}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                />
                <Input
                  label={t('dataResidency.field.port')}
                  type="number"
                  value={form.port}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, port: e.target.value })}
                />
                <Input
                  label={t('dataResidency.field.database')}
                  value={form.database}
                  disabled={busy}
                  onChange={(e) =>
                    setForm({ ...form, database: e.target.value })
                  }
                />
                <Input
                  label={t('dataResidency.field.user')}
                  value={form.user}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, user: e.target.value })}
                />
                <Select
                  label={t('dataResidency.field.sslMode')}
                  value={form.sslmode}
                  disabled={busy}
                  onValueChange={(v) => {
                    if (isSslMode(v)) setForm({ ...form, sslmode: v });
                  }}
                  options={SSL_MODES.map((m) => ({ value: m, label: m }))}
                />
                <Input
                  label={t('dataResidency.field.password')}
                  type="password"
                  value={form.password}
                  disabled={busy}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                  description={
                    view?.hasPassword
                      ? t('dataResidency.password.storedNoPreviewHint')
                      : t('dataResidency.password.writeOnlyHint')
                  }
                />
              </div>
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
                  disabled={busy || test.isPending}
                >
                  {test.isPending
                    ? t('dataResidency.testing')
                    : t('dataResidency.testConnection')}
                </Button>
                <TestResultLine
                  result={testResult}
                  okLabel={t('dataResidency.result.ok')}
                />
              </HStack>
              <Alert description={t('dataResidency.knowledge.paradeDbNote')} />
              <p className="text-muted-foreground text-xs">
                {t('orgDataResidency.knowledge.note')}
              </p>
            </Stack>
          ) : // Off = deployment default: the status pill already says so.
          null}
        </>
      )}

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t('orgDataResidency.knowledge.clearConfirm.title')}
        description={t('orgDataResidency.knowledge.clearConfirm.description')}
        confirmText={t('orgDataResidency.knowledge.clearConfirm.confirm')}
        isLoading={remove.isPending}
        variant="destructive"
        onConfirm={() => void onClear()}
      />
    </SettingsSection>
  );
}

function StorageSection({
  organizationId,
  view,
  readError,
  className,
}: {
  organizationId: string;
  view: StorageView | undefined;
  readError?: string;
  className?: string;
}) {
  const { t } = useT('settings');
  const baseline = storageFromView(view);
  const [form, setFormRaw] = useState(baseline);
  const [feedback, setFeedback] = useState<SectionFeedback>(null);
  const [testResult, setTestResult] = useState<TestResult>(undefined);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const save = useSaveOrgObjectStorageConnection(organizationId);
  const remove = useDeleteOrgObjectStorageConnection(organizationId);
  const test = useTestOrgObjectStorageConnection();

  const viewKey = JSON.stringify(view ?? null);
  useEffect(() => {
    setFormRaw(storageFromView(view));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);

  const dirty = !structuralEqual(form, baseline);
  const busy = save.isPending || remove.isPending;
  // The S3 probe always needs a key pair (stored keys are never read back
  // into the form), so Test stays off until both are entered.
  const canTest =
    form.accessKeyId.length > 0 && form.secretAccessKey.length > 0;

  function setForm(next: StorageForm) {
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
        accessKeyId: form.accessKeyId,
        secretAccessKey: form.secretAccessKey,
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
    setForm(emptyStorage());
  }

  return (
    <SettingsSection
      className={className}
      title={t('orgDataResidency.storage.title')}
      description={t('orgDataResidency.storage.description')}
      action={
        readError ? undefined : (
          <SectionToggle
            enabledLabel={t('dataResidency.storage.externalS3')}
            enabled={form.enabled}
            disabled={busy}
            onToggle={onToggle}
          />
        )
      }
    >
      {readError ? (
        <Alert
          variant="warning"
          description={t('orgDataResidency.errors.readFailed', {
            error: readError,
          })}
        />
      ) : (
        <>
          <SectionFeedbackView
            feedback={feedback}
            dirty={dirty}
            savedText={t('orgDataResidency.storage.saved')}
            clearedText={t('orgDataResidency.storage.cleared')}
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
                  label={t('orgDataResidency.storage.bucket')}
                  value={form.bucket}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, bucket: e.target.value })}
                />
                <Input
                  label={t('orgDataResidency.storage.prefix')}
                  value={form.prefix}
                  disabled={busy}
                  onChange={(e) => setForm({ ...form, prefix: e.target.value })}
                  description={t('orgDataResidency.storage.prefixHint')}
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
                description={t('orgDataResidency.storage.credentialsHint')}
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
                  okLabel={t('orgDataResidency.storage.verified')}
                />
              </HStack>
              <p className="text-muted-foreground text-xs">
                {t('orgDataResidency.storage.note')}
              </p>
            </Stack>
          ) : // Off = deployment default: the status pill already says so.
          null}
        </>
      )}

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t('orgDataResidency.storage.clearConfirm.title')}
        description={t('orgDataResidency.storage.clearConfirm.description')}
        confirmText={t('orgDataResidency.storage.clearConfirm.confirm')}
        isLoading={remove.isPending}
        variant="destructive"
        onConfirm={() => void onClear()}
      />
    </SettingsSection>
  );
}

export function OrgDataResidencySettings({
  organizationId,
}: {
  organizationId: string;
}) {
  const { t } = useT('settings');
  const { t: tAccessDenied } = useT('accessDenied');
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const knowledgeQuery = useOrgKnowledgeConnection(organizationId);
  const storageQuery = useOrgObjectStorageConnection(organizationId);

  // Managing residency is a write concern — gate on the same capability the
  // backend actions enforce (`write orgSettings`).
  if (!abilityLoading && ability.cannot('write', 'orgSettings')) {
    return <AccessDenied message={tAccessDenied('orgDataResidency')} />;
  }

  // A failed read must not fall through to a blank, default-looking form —
  // that would imply "deployment default" when the truth is unknown. Each
  // section reports its own read failure so the other stays usable.
  const knowledgeReadError = knowledgeQuery.isError
    ? mapOrgResidencyError(knowledgeQuery.error, t)
    : undefined;
  const storageReadError = storageQuery.isError
    ? mapOrgResidencyError(storageQuery.error, t)
    : undefined;

  return (
    <Skeletonize
      loading={
        abilityLoading || knowledgeQuery.isPending || storageQuery.isPending
      }
    >
      <SettingsPage>
        <KnowledgeSection
          organizationId={organizationId}
          view={knowledgeQuery.data}
          readError={knowledgeReadError}
        />
        <StorageSection
          className="border-border border-t pt-8"
          organizationId={organizationId}
          view={storageQuery.data}
          readError={storageReadError}
        />
      </SettingsPage>
    </Skeletonize>
  );
}
