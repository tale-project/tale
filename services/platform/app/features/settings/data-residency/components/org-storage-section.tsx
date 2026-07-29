'use client';

/**
 * The organization's BYO object-storage connection (S3-compatible bucket).
 * Editable by an org admin (`write orgSettings`); a member without that
 * capability sees the stored coordinates read-only with a stated reason.
 *
 * On the unified editor contract: fields batch through the settings header's
 * Discard/Save cluster; Test (a real PUT+GET+DELETE probe) and the blob
 * backfill are instant actions, and switching OFF a saved connection is the
 * remove flow (confirm dialog + toast). Credential semantics survive the port:
 * enter both keys or neither — both blank keeps the stored pair, and a probe
 * with blank keys tests the stored pair ("Save, then Test").
 */

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import { Switch } from '@/app/components/ui/forms/switch';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { SettingsToggleRow } from '@/app/features/settings/components/settings-toggle-row';
import { TestResultLine } from '@/app/features/settings/components/test-result-line';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { structuralEqual } from '@/lib/utils/structural-equal';

import {
  useDeleteOrgObjectStorageConnection,
  useSaveOrgObjectStorageConnection,
  useStartObjectStorageBackfill,
  useTestOrgObjectStorageConnection,
} from '../hooks/mutations';
import { useObjectStorageBackfillStatus } from '../hooks/queries';
import {
  mapOrgResidencyError,
  orgResidencyErrorCode,
} from '../org-residency-errors';
import { READ_ONLY_EMPTY, StatusBadge } from './residency-chrome';

/** Masked read of the org's object-storage connection. */
export interface StorageView {
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

type StorageForm = {
  region: string;
  endpoint: string;
  forcePathStyle: boolean;
  bucket: string;
  prefix: string;
  accessKeyId: string; // write-only
  secretAccessKey: string; // write-only
};

const EMPTY_FORM: StorageForm = {
  region: '',
  endpoint: '',
  forcePathStyle: false,
  bucket: '',
  prefix: '',
  accessKeyId: '',
  secretAccessKey: '',
};

function formFromView(view: StorageView | undefined): StorageForm | undefined {
  if (view === undefined) return undefined;
  if (!view.configured) return EMPTY_FORM;
  return {
    region: view.region ?? '',
    endpoint: view.endpoint ?? '',
    forcePathStyle: Boolean(view.forcePathStyle),
    bucket: view.bucket ?? '',
    prefix: view.prefix ?? '',
    accessKeyId: '',
    secretAccessKey: '',
  };
}

function isValidEndpoint(value: string): boolean {
  if (value === '') return true;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

const FORM_ID = 'org-storage-form';

export function OrgStorageSection({
  organizationId,
  view,
  readError,
  readOnly,
}: {
  organizationId: string;
  view: StorageView | undefined;
  readError?: string;
  readOnly: boolean;
}) {
  const { t } = useT('settings');
  const { t: tCommon } = useT('common');
  const { toast } = useToast();

  const save = useSaveOrgObjectStorageConnection(organizationId);
  const remove = useDeleteOrgObjectStorageConnection(organizationId);
  const test = useTestOrgObjectStorageConnection();
  const startBackfill = useStartObjectStorageBackfill();
  // The status query THROWS for members without `write orgSettings`, so it is
  // skipped (not merely hidden) for read-only viewers.
  const backfillStatus = useObjectStorageBackfillStatus(
    organizationId,
    !readOnly,
  );

  // The switch only REVEALS the form; turning a SAVED connection off routes
  // through the remove confirm instead (same contract as the knowledge
  // section).
  const [enabled, setEnabled] = useState(Boolean(view?.configured));
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [backfillConfirmOpen, setBackfillConfirmOpen] = useState(false);
  const [testResult, setTestResult] = useState<
    { ok: boolean; message?: string } | undefined
  >(undefined);

  const configured = Boolean(view?.configured);
  useEffect(() => {
    setEnabled(configured);
  }, [configured]);

  // The section stays registered with the header's Save cluster even while
  // collapsed (the cluster is a permanent fixture for org admins), so its
  // untouched-empty form must count as VALID — it isn't dirty, so the group
  // never tries to save it. The moment any field diverges, the full
  // constraints apply; once a config exists, empty is invalid too (removal
  // goes through the toggle, not an empty save).
  const schema = useMemo(
    () =>
      z
        .object({
          region: z.string(),
          endpoint: z.string(),
          forcePathStyle: z.boolean(),
          bucket: z.string(),
          prefix: z.string(),
          accessKeyId: z.string(),
          secretAccessKey: z.string(),
        })
        .superRefine((values, ctx) => {
          if (!configured && structuralEqual(values, EMPTY_FORM)) return;
          if (values.region === '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['region'],
              message: t('dataResidency.orgStorage.errors.regionRequired'),
            });
          }
          if (!isValidEndpoint(values.endpoint)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['endpoint'],
              message: t('dataResidency.orgStorage.errors.endpointInvalid'),
            });
          }
          if (values.bucket === '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['bucket'],
              message: t('dataResidency.orgStorage.errors.bucketRequired'),
            });
          }
          // Pair-or-none, verified where the admin can fix it: the blank half
          // of a half-entered pair gets the message.
          const hasKey = values.accessKeyId.length > 0;
          const hasSecret = values.secretAccessKey.length > 0;
          if (hasKey !== hasSecret) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [hasKey ? 'secretAccessKey' : 'accessKeyId'],
              message: t('dataResidency.orgStorage.errors.credentialsPair'),
            });
          }
        }),
    [t, configured],
  );

  const data = useMemo(() => formFromView(view), [view]);

  const saveForm = useCallback(
    async (values: StorageForm) => {
      try {
        await save.mutateAsync({
          organizationId,
          region: values.region.trim(),
          ...(values.endpoint.trim()
            ? { endpoint: values.endpoint.trim() }
            : {}),
          forcePathStyle: values.forcePathStyle,
          bucket: values.bucket.trim(),
          ...(values.prefix.trim() ? { prefix: values.prefix.trim() } : {}),
          // Both blank leaves the stored key pair untouched (edit of the
          // bucket coordinates); the server enforces pair-or-none and
          // first-time keys.
          ...(values.accessKeyId ? { accessKeyId: values.accessKeyId } : {}),
          ...(values.secretAccessKey
            ? { secretAccessKey: values.secretAccessKey }
            : {}),
        });
      } catch (err) {
        // A first-time save without keys belongs at the key fields — rethrow
        // untouched so `mapServerError` can pin it there; anything else
        // becomes the translated line the header cluster toasts once.
        if (orgResidencyErrorCode(err) === 'CREDENTIALS_REQUIRED') {
          throw err;
        }
        throw new Error(mapOrgResidencyError(err, t), { cause: err });
      }
    },
    [organizationId, save, t],
  );

  // A first-time save without keys is fixed at the key fields, not in a toast.
  const mapServerError = useCallback(
    (err: unknown) => {
      if (orgResidencyErrorCode(err) === 'CREDENTIALS_REQUIRED') {
        return [
          {
            path: 'accessKeyId',
            message: t('dataResidency.orgStorage.errors.credentialsRequired'),
          },
        ];
      }
      return null;
    },
    [t],
  );

  const editor = useFormEditor<StorageForm>({
    data,
    defaultValues: EMPTY_FORM,
    schema,
    save: saveForm,
    mapServerError,
  });
  useRegisterGroupedEditor(editor, { enabled: !readOnly });

  // A probe result describes the values it was run against — editing any
  // field makes it stale.
  useEffect(() => {
    const sub = editor.form.watch(() => setTestResult(undefined));
    return () => sub.unsubscribe();
  }, [editor.form]);

  const {
    register,
    getValues,
    watch,
    formState: { errors },
  } = editor.form;

  // Test with EITHER a freshly entered key pair OR — once keys are stored —
  // no keys at all (the server reuses the sidecar). This is what makes
  // "Save, then Test" work: Save clears the write-only fields, so a follow-up
  // Test carries no keys but must still validate the stored connection. A
  // half-entered pair (one field filled) stays off — the probe needs both.
  const [watchedKeyId, watchedSecret] = watch([
    'accessKeyId',
    'secretAccessKey',
  ]);
  const bothKeysEntered = watchedKeyId.length > 0 && watchedSecret.length > 0;
  const noKeysEntered = watchedKeyId.length === 0 && watchedSecret.length === 0;
  const canTest =
    bothKeysEntered || (noKeysEntered && (view?.hasCredentials ?? false));

  async function onTest() {
    setTestResult(undefined);
    const values = getValues();
    try {
      const res: StorageProbeResult = await test.mutateAsync({
        organizationId,
        region: values.region.trim(),
        ...(values.endpoint.trim() ? { endpoint: values.endpoint.trim() } : {}),
        forcePathStyle: values.forcePathStyle,
        bucket: values.bucket.trim(),
        ...(values.prefix.trim() ? { prefix: values.prefix.trim() } : {}),
        ...(values.accessKeyId ? { accessKeyId: values.accessKeyId } : {}),
        ...(values.secretAccessKey
          ? { secretAccessKey: values.secretAccessKey }
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
      toast({ description: t('dataResidency.orgStorage.cleared') });
    } catch (err) {
      toast({
        variant: 'destructive',
        description: mapOrgResidencyError(err, t),
      });
    } finally {
      setClearConfirmOpen(false);
    }
  }

  async function onStartBackfill() {
    try {
      await startBackfill.mutateAsync({ organizationId });
      // No success toast: the status line below flips to "running" reactively.
    } catch (err) {
      toast({
        variant: 'destructive',
        description: mapOrgResidencyError(err, t),
      });
    } finally {
      setBackfillConfirmOpen(false);
    }
  }

  function onToggle(checked: boolean) {
    if (checked) {
      setEnabled(true);
      return;
    }
    if (configured) {
      setClearConfirmOpen(true);
      return;
    }
    editor.reset();
    setEnabled(false);
  }

  const run = backfillStatus.data;
  const backfillRunning = run?.status === 'running';
  const backfillLine = !run
    ? undefined
    : run.status === 'running'
      ? t('dataResidency.orgStorage.backfill.status.running', {
          migrated: run.migrated,
          failed: run.failed,
        })
      : run.status === 'completed'
        ? run.dryRun
          ? t('dataResidency.orgStorage.backfill.status.completedDry', {
              candidates: run.candidates,
            })
          : t('dataResidency.orgStorage.backfill.status.completed', {
              migrated: run.migrated,
              failed: run.failed,
            })
        : t('dataResidency.orgStorage.backfill.status.failed', {
            error: run.lastError ?? '',
          });

  const onLabel = t('dataResidency.storage.externalS3');
  const offLabel = t('dataResidency.orgStorage.statusDefault');

  return (
    <SettingsSection
      title={t('dataResidency.orgStorage.title')}
      description={t('dataResidency.orgStorage.description')}
      action={
        readError ? undefined : readOnly ? (
          <StatusBadge
            enabled={enabled}
            onLabel={onLabel}
            offLabel={offLabel}
          />
        ) : (
          <HStack gap={2} align="center">
            <StatusBadge
              enabled={enabled}
              onLabel={onLabel}
              offLabel={offLabel}
            />
            <Switch
              aria-label={onLabel}
              checked={enabled}
              disabled={remove.isPending}
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
            description={
              <>
                <strong>{t('dataResidency.readOnly.title')}</strong>{' '}
                {t('dataResidency.orgStorage.readOnlyBody')}
              </>
            }
          />
          {enabled ? (
            <Stack gap={5}>
              <SettingsFieldList>
                <SettingsFieldRow label={t('dataResidency.storage.region')}>
                  <Input
                    aria-label={t('dataResidency.storage.region')}
                    value={view?.region || READ_ONLY_EMPTY}
                    readOnly
                  />
                </SettingsFieldRow>
                <SettingsFieldRow label={t('dataResidency.storage.endpoint')}>
                  <Input
                    aria-label={t('dataResidency.storage.endpoint')}
                    value={view?.endpoint || READ_ONLY_EMPTY}
                    readOnly
                  />
                </SettingsFieldRow>
                <SettingsFieldRow label={t('dataResidency.orgStorage.bucket')}>
                  <Input
                    aria-label={t('dataResidency.orgStorage.bucket')}
                    value={view?.bucket || READ_ONLY_EMPTY}
                    readOnly
                  />
                </SettingsFieldRow>
                <SettingsFieldRow label={t('dataResidency.orgStorage.prefix')}>
                  <Input
                    aria-label={t('dataResidency.orgStorage.prefix')}
                    value={view?.prefix || READ_ONLY_EMPTY}
                    readOnly
                  />
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('dataResidency.storage.forcePathStyle')}
                >
                  <Input
                    aria-label={t('dataResidency.storage.forcePathStyle')}
                    value={
                      view?.forcePathStyle
                        ? tCommon('status.enabled')
                        : tCommon('status.disabled')
                    }
                    readOnly
                  />
                </SettingsFieldRow>
              </SettingsFieldList>
              <p className="text-muted-foreground text-xs">
                {t('dataResidency.orgStorage.note')}
              </p>
            </Stack>
          ) : null}
        </>
      ) : enabled ? (
        <Stack gap={5}>
          <form id={FORM_ID} onSubmit={editor.submit}>
            <fieldset disabled={editor.isLoading} className="contents">
              <SettingsFieldList>
                <SettingsFieldRow label={t('dataResidency.storage.region')}>
                  <Input
                    aria-label={t('dataResidency.storage.region')}
                    wrapperClassName="w-full"
                    errorMessage={errors.region?.message}
                    {...register('region')}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow label={t('dataResidency.storage.endpoint')}>
                  <Input
                    aria-label={t('dataResidency.storage.endpoint')}
                    wrapperClassName="w-full"
                    errorMessage={errors.endpoint?.message}
                    {...register('endpoint')}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow label={t('dataResidency.orgStorage.bucket')}>
                  <Input
                    aria-label={t('dataResidency.orgStorage.bucket')}
                    wrapperClassName="w-full"
                    errorMessage={errors.bucket?.message}
                    {...register('bucket')}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('dataResidency.orgStorage.prefix')}
                  description={t('dataResidency.orgStorage.prefixHint')}
                >
                  <Input
                    aria-label={t('dataResidency.orgStorage.prefix')}
                    wrapperClassName="w-full"
                    errorMessage={errors.prefix?.message}
                    {...register('prefix')}
                  />
                </SettingsFieldRow>
                <SettingsToggleRow
                  label={t('dataResidency.storage.forcePathStyle')}
                  checked={watch('forcePathStyle')}
                  onCheckedChange={(checked) =>
                    editor.form.setValue('forcePathStyle', checked, {
                      shouldDirty: true,
                    })
                  }
                />
                <SettingsFieldRow
                  label={t('dataResidency.storage.accessKeyId')}
                  description={
                    view?.hasCredentials
                      ? t('dataResidency.password.storedNoPreviewHint')
                      : t('dataResidency.orgStorage.credentialsHint')
                  }
                >
                  <Input
                    aria-label={t('dataResidency.storage.accessKeyId')}
                    wrapperClassName="w-full"
                    errorMessage={errors.accessKeyId?.message}
                    {...register('accessKeyId')}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('dataResidency.storage.secretAccessKey')}
                  description={
                    view?.hasCredentials
                      ? t('dataResidency.password.storedNoPreviewHint')
                      : t('dataResidency.storage.writeOnly')
                  }
                >
                  <Input
                    aria-label={t('dataResidency.storage.secretAccessKey')}
                    type="password"
                    wrapperClassName="w-full"
                    errorMessage={errors.secretAccessKey?.message}
                    {...register('secretAccessKey')}
                  />
                </SettingsFieldRow>
              </SettingsFieldList>
            </fieldset>
          </form>
          <HStack gap={3} align="center" className="flex-wrap">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void onTest()}
              disabled={test.isPending || remove.isPending || !canTest}
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
          {configured ? (
            <Stack gap={2}>
              <HStack gap={3} align="center" className="flex-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setBackfillConfirmOpen(true)}
                  disabled={startBackfill.isPending || backfillRunning}
                >
                  {t('dataResidency.orgStorage.backfill.start')}
                </Button>
                {backfillLine ? (
                  <span className="text-muted-foreground text-sm" role="status">
                    {backfillLine}
                  </span>
                ) : null}
              </HStack>
              <p className="text-muted-foreground text-xs">
                {t('dataResidency.orgStorage.backfill.description')}
              </p>
            </Stack>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {t('dataResidency.orgStorage.note')}
          </p>
        </Stack>
      ) : // Off = deployment default: the status pill already says so.
      null}

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

      <ConfirmDialog
        open={backfillConfirmOpen}
        onOpenChange={setBackfillConfirmOpen}
        title={t('dataResidency.orgStorage.backfill.confirm.title')}
        description={t('dataResidency.orgStorage.backfill.confirm.description')}
        confirmText={t('dataResidency.orgStorage.backfill.confirm.confirm')}
        isLoading={startBackfill.isPending}
        onConfirm={() => void onStartBackfill()}
      />
    </SettingsSection>
  );
}
