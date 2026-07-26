'use client';

/**
 * The organization's BYO knowledge database (the Postgres/ParadeDB instance
 * holding its RAG corpus). Editable by an org admin (`write orgSettings`); a
 * member without that capability sees the stored coordinates read-only with a
 * stated reason.
 *
 * On the unified editor contract: the fields batch through the settings
 * header's Discard/Save cluster (`useFormEditor` + `useRegisterGroupedEditor`),
 * while Test (probe) and Remove stay instant actions — the probe reports
 * inline via `TestResultLine`, removal confirms via dialog and reports through
 * a toast. The enable switch only reveals the form; nothing is saved until the
 * header Save commits, and switching OFF a saved connection is the remove
 * flow.
 */

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { HStack, Stack } from '@tale/ui/layout';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';

import { ConfirmDialog } from '@/app/components/ui/dialog/confirm-dialog';
import {
  useFormEditor,
  useRegisterGroupedEditor,
} from '@/app/components/ui/editor';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { Switch } from '@/app/components/ui/forms/switch';
import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { TestResultLine } from '@/app/features/settings/components/test-result-line';
import { useToast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { structuralEqual } from '@/lib/utils/structural-equal';

import {
  useDeleteOrgKnowledgeConnection,
  useSaveOrgKnowledgeConnection,
  useTestOrgKnowledgeConnection,
} from '../hooks/mutations';
import { mapOrgResidencyError } from '../org-residency-errors';
import { READ_ONLY_EMPTY, StatusBadge } from './residency-chrome';

const SSL_MODES = [
  'disable',
  'prefer',
  'require',
  'verify-ca',
  'verify-full',
] as const;
type SslMode = (typeof SSL_MODES)[number];

// Mirrors `pgConnectionSchema`'s host guard (hostname / IPv4 / IPv6 characters
// only) — the server re-validates authoritatively; this copy exists so the
// form can explain the refusal in the caller's language.
const HOST_PATTERN = /^[A-Za-z0-9._:[\]-]+$/;

/** Masked read of the org's knowledge-DB connection. */
export interface KnowledgeConnectionView {
  configured: boolean;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  sslmode?: string;
  hasPassword?: boolean;
}

/** Probe result shape (the action declares `returns: v.any()`). */
interface KnowledgeProbeResult {
  ok: boolean;
  error?: string;
  hint?: string;
}

type KnowledgeForm = {
  host: string;
  port: number;
  database: string;
  user: string;
  sslmode: SslMode;
  password: string; // write-only; blank = keep stored
};

const EMPTY_FORM: KnowledgeForm = {
  host: '',
  port: 5432,
  database: '',
  user: '',
  sslmode: 'require',
  password: '',
};

function formFromView(
  view: KnowledgeConnectionView | undefined,
): KnowledgeForm | undefined {
  if (view === undefined) return undefined;
  if (!view.configured) return EMPTY_FORM;
  const sslmode = SSL_MODES.find((m) => m === view.sslmode) ?? 'require';
  return {
    host: view.host ?? '',
    port: view.port ?? 5432,
    database: view.database ?? '',
    user: view.user ?? '',
    sslmode,
    password: '',
  };
}

const FORM_ID = 'org-knowledge-form';

export function OrgKnowledgeSection({
  organizationId,
  view,
  readError,
  readOnly,
}: {
  organizationId: string;
  view: KnowledgeConnectionView | undefined;
  readError?: string;
  readOnly: boolean;
}) {
  const { t } = useT('settings');
  const { toast } = useToast();

  const save = useSaveOrgKnowledgeConnection(organizationId);
  const remove = useDeleteOrgKnowledgeConnection(organizationId);
  const test = useTestOrgKnowledgeConnection();

  // The switch only REVEALS the form (nothing exists to save yet when it is
  // first turned on), so it is deliberately local state, not a form field.
  // Turning a SAVED connection off routes through the remove confirm instead.
  const [enabled, setEnabled] = useState(Boolean(view?.configured));
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
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
          host: z.string(),
          port: z.number({
            message: t('dataResidency.orgKnowledge.errors.portInvalid'),
          }),
          database: z.string(),
          user: z.string(),
          sslmode: z.enum(SSL_MODES),
          password: z.string(),
        })
        .superRefine((values, ctx) => {
          if (!configured && structuralEqual(values, EMPTY_FORM)) return;
          if (values.host === '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['host'],
              message: t('dataResidency.orgKnowledge.errors.hostRequired'),
            });
          } else if (!HOST_PATTERN.test(values.host)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['host'],
              message: t('dataResidency.orgKnowledge.errors.hostInvalid'),
            });
          }
          if (
            !Number.isInteger(values.port) ||
            values.port < 1 ||
            values.port > 65_535
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['port'],
              message: t('dataResidency.orgKnowledge.errors.portInvalid'),
            });
          }
          if (values.database === '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['database'],
              message: t('dataResidency.orgKnowledge.errors.databaseRequired'),
            });
          }
          if (values.user === '') {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['user'],
              message: t('dataResidency.orgKnowledge.errors.userRequired'),
            });
          }
        }),
    [t, configured],
  );

  const data = useMemo(() => formFromView(view), [view]);

  // Header-cluster save: throw a translated message on failure (ONE
  // destructive toast, owned by EditorActions), never toast here. A blank
  // password means "keep the stored one" — the UI never sends the
  // remove-password empty string; reverting to passwordless goes through
  // Remove + reconfigure (or the config file/API).
  const saveForm = useCallback(
    async (values: KnowledgeForm) => {
      try {
        await save.mutateAsync({
          organizationId,
          host: values.host.trim(),
          port: values.port,
          database: values.database.trim(),
          user: values.user.trim(),
          sslmode: values.sslmode,
          password: values.password ? values.password : null,
        });
      } catch (err) {
        throw new Error(mapOrgResidencyError(err, t), { cause: err });
      }
    },
    [organizationId, save, t],
  );

  const editor = useFormEditor<KnowledgeForm>({
    data,
    defaultValues: EMPTY_FORM,
    schema,
    save: saveForm,
  });
  useRegisterGroupedEditor(editor, { enabled: !readOnly });

  // A probe result describes the values it was run against — editing any
  // field makes it stale, so it clears on the next form change.
  useEffect(() => {
    const sub = editor.form.watch(() => setTestResult(undefined));
    return () => sub.unsubscribe();
  }, [editor.form]);

  const {
    register,
    control,
    getValues,
    formState: { errors },
  } = editor.form;

  async function onTest() {
    setTestResult(undefined);
    const values = getValues();
    try {
      const res: KnowledgeProbeResult = await test.mutateAsync({
        organizationId,
        host: values.host.trim(),
        // An untouched number input reads as NaN; probe the schema default.
        port: Number.isNaN(values.port) ? 5432 : values.port,
        database: values.database.trim(),
        user: values.user.trim(),
        sslmode: values.sslmode,
        // Blank reuses the stored sidecar server-side, so "Save, then Test"
        // works without re-entering the password.
        password: values.password ? values.password : undefined,
      });
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
      toast({ description: t('dataResidency.orgKnowledge.cleared') });
    } catch (err) {
      toast({
        variant: 'destructive',
        description: mapOrgResidencyError(err, t),
      });
    } finally {
      setClearConfirmOpen(false);
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

  const onLabel = t('dataResidency.externalPostgres');
  const offLabel = t('dataResidency.orgKnowledge.statusDefault');

  return (
    <SettingsSection
      title={t('dataResidency.orgKnowledge.title')}
      description={t('dataResidency.orgKnowledge.description')}
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
          description={t('dataResidency.orgKnowledge.errors.readFailed', {
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
                {t('dataResidency.orgKnowledge.readOnlyBody')}
              </>
            }
          />
          {enabled ? (
            <SettingsFieldList>
              <SettingsFieldRow label={t('dataResidency.field.host')}>
                <Input
                  aria-label={t('dataResidency.field.host')}
                  value={view?.host || READ_ONLY_EMPTY}
                  readOnly
                />
              </SettingsFieldRow>
              <SettingsFieldRow label={t('dataResidency.field.port')}>
                <Input
                  aria-label={t('dataResidency.field.port')}
                  value={view?.port ? String(view.port) : READ_ONLY_EMPTY}
                  readOnly
                />
              </SettingsFieldRow>
              <SettingsFieldRow label={t('dataResidency.field.database')}>
                <Input
                  aria-label={t('dataResidency.field.database')}
                  value={view?.database || READ_ONLY_EMPTY}
                  readOnly
                />
              </SettingsFieldRow>
              <SettingsFieldRow label={t('dataResidency.field.user')}>
                <Input
                  aria-label={t('dataResidency.field.user')}
                  value={view?.user || READ_ONLY_EMPTY}
                  readOnly
                />
              </SettingsFieldRow>
              <SettingsFieldRow label={t('dataResidency.field.sslMode')}>
                <Input
                  aria-label={t('dataResidency.field.sslMode')}
                  value={view?.sslmode || READ_ONLY_EMPTY}
                  readOnly
                />
              </SettingsFieldRow>
            </SettingsFieldList>
          ) : null}
        </>
      ) : enabled ? (
        <Stack gap={5}>
          <form id={FORM_ID} onSubmit={editor.submit}>
            <fieldset disabled={editor.isLoading} className="contents">
              <SettingsFieldList>
                <SettingsFieldRow label={t('dataResidency.field.host')}>
                  <Input
                    aria-label={t('dataResidency.field.host')}
                    wrapperClassName="w-full"
                    errorMessage={errors.host?.message}
                    {...register('host')}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow label={t('dataResidency.field.port')}>
                  <Input
                    aria-label={t('dataResidency.field.port')}
                    type="number"
                    min={1}
                    max={65535}
                    step={1}
                    wrapperClassName="w-full"
                    errorMessage={errors.port?.message}
                    {...register('port', { valueAsNumber: true })}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow label={t('dataResidency.field.database')}>
                  <Input
                    aria-label={t('dataResidency.field.database')}
                    wrapperClassName="w-full"
                    errorMessage={errors.database?.message}
                    {...register('database')}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow label={t('dataResidency.field.user')}>
                  <Input
                    aria-label={t('dataResidency.field.user')}
                    wrapperClassName="w-full"
                    errorMessage={errors.user?.message}
                    {...register('user')}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow label={t('dataResidency.field.sslMode')}>
                  {/* Controlled via RHF `Controller`: a Radix Select has no
                      native input for `register` to bind. */}
                  <Controller
                    control={control}
                    name="sslmode"
                    render={({ field }) => (
                      <Select
                        aria-label={t('dataResidency.field.sslMode')}
                        value={field.value}
                        onValueChange={field.onChange}
                        options={SSL_MODES.map((m) => ({
                          value: m,
                          label: m,
                        }))}
                      />
                    )}
                  />
                </SettingsFieldRow>
                <SettingsFieldRow
                  label={t('dataResidency.field.password')}
                  description={
                    view?.hasPassword
                      ? t('dataResidency.password.storedNoPreviewHint')
                      : t('dataResidency.password.writeOnlyHint')
                  }
                >
                  <Input
                    aria-label={t('dataResidency.field.password')}
                    type="password"
                    wrapperClassName="w-full"
                    {...register('password')}
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
              disabled={test.isPending || remove.isPending}
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
            {t('dataResidency.orgKnowledge.note')}
          </p>
        </Stack>
      ) : // Off = deployment default: the status pill already says so.
      null}

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title={t('dataResidency.orgKnowledge.clearConfirm.title')}
        description={t('dataResidency.orgKnowledge.clearConfirm.description')}
        confirmText={t('dataResidency.orgKnowledge.clearConfirm.confirm')}
        isLoading={remove.isPending}
        variant="destructive"
        onConfirm={() => void onClear()}
      />
    </SettingsSection>
  );
}
