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

import {
  KNOWLEDGE_CONNECTION_PASSWORD_MAX,
  PG_HOST_PATTERN,
} from '@tale/shared/schemas/knowledge';
import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { useFormEditor, useRegisterGroupedEditor } from '@tale/ui/editor';
import { Input } from '@tale/ui/input';
import { HStack, Stack } from '@tale/ui/layout';
import { Select } from '@tale/ui/select';
import { structuralEqual } from '@tale/ui/structural-equal';
import { Switch } from '@tale/ui/switch';
import { useToast } from '@tale/ui/use-toast';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller } from 'react-hook-form';
import { z } from 'zod';

import {
  SettingsFieldList,
  SettingsFieldRow,
} from '@/app/features/settings/components/settings-field-list';
import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { TestResultLine } from '@/app/features/settings/components/test-result-line';
import { useT } from '@/lib/i18n/client';

import {
  useDeleteOrgKnowledgeConnection,
  useSaveOrgKnowledgeConnection,
  useTestOrgKnowledgeConnection,
} from '../hooks/mutations';
import { useConnectionTestResult } from '../hooks/use-connection-test-result';
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

type Translator = (key: string, options?: Record<string, unknown>) => string;

/**
 * What the door would refuse in these values, named per field in the
 * caller's language — the door's own rules (`pgConnectionSchema`'s host
 * characters, port range and required fields, the password cap), applied
 * to the values as they will be SENT: trimmed. A database of spaces passed
 * the old `=== ''` check, was trimmed to nothing on the way out, and came
 * back as a bare `invalid body`. Save and Test both check through here.
 */
function knowledgeFormIssues(
  values: KnowledgeForm,
  t: Translator,
  tCommon: Translator,
): { path: keyof KnowledgeForm; message: string }[] {
  const issues: { path: keyof KnowledgeForm; message: string }[] = [];
  const host = values.host.trim();
  if (host === '') {
    issues.push({
      path: 'host',
      message: t('dataResidency.orgKnowledge.errors.hostRequired'),
    });
  } else if (!PG_HOST_PATTERN.test(host)) {
    issues.push({
      path: 'host',
      message: t('dataResidency.orgKnowledge.errors.hostInvalid'),
    });
  }
  if (
    !Number.isInteger(values.port) ||
    values.port < 1 ||
    values.port > 65_535
  ) {
    issues.push({
      path: 'port',
      message: t('dataResidency.orgKnowledge.errors.portInvalid'),
    });
  }
  if (values.database.trim() === '') {
    issues.push({
      path: 'database',
      message: t('dataResidency.orgKnowledge.errors.databaseRequired'),
    });
  }
  if (values.user.trim() === '') {
    issues.push({
      path: 'user',
      message: t('dataResidency.orgKnowledge.errors.userRequired'),
    });
  }
  if (values.password.length > KNOWLEDGE_CONNECTION_PASSWORD_MAX) {
    issues.push({
      path: 'password',
      message: tCommon('validation.maxLength', {
        field: t('dataResidency.field.password'),
        max: KNOWLEDGE_CONNECTION_PASSWORD_MAX,
      }),
    });
  }
  return issues;
}

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
  const { t: tCommon } = useT('common');
  const { toast } = useToast();

  const save = useSaveOrgKnowledgeConnection(organizationId);
  const remove = useDeleteOrgKnowledgeConnection(organizationId);
  const test = useTestOrgKnowledgeConnection();

  // The switch only REVEALS the form (nothing exists to save yet when it is
  // first turned on), so it is deliberately local state, not a form field.
  // Turning a SAVED connection off routes through the remove confirm instead.
  const [enabled, setEnabled] = useState(Boolean(view?.configured));
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

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
          for (const issue of knowledgeFormIssues(values, t, tCommon)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [issue.path],
              message: issue.message,
            });
          }
        }),
    [t, tCommon, configured],
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
    // The reveal switch lives outside the form, so a Discard — the header's
    // as much as this section's — has to put it back to the saved state too.
    onReset: () => setEnabled(configured),
  });
  useRegisterGroupedEditor(editor, { enabled: !readOnly });

  const { testResult, clearTestResult, beginTest } = useConnectionTestResult(
    editor.form,
    organizationId,
  );

  const {
    register,
    control,
    getValues,
    setError,
    formState: { errors },
  } = editor.form;

  async function onTest() {
    const publishResult = beginTest();
    const typed = getValues();
    // An untouched number input reads as NaN; probe the schema default.
    const values = {
      ...typed,
      port: Number.isNaN(typed.port) ? 5432 : typed.port,
    };
    // The probe takes the same body as Save: name what it would refuse
    // under its field instead of sending it (an empty form used to come
    // back as a bare `invalid body` on the result line).
    const issues = knowledgeFormIssues(values, t, tCommon);
    if (issues.length > 0) {
      issues.forEach((issue, index) =>
        setError(
          issue.path,
          { type: 'manual', message: issue.message },
          { shouldFocus: index === 0 },
        ),
      );
      return;
    }
    try {
      const res: KnowledgeProbeResult = await test.mutateAsync({
        organizationId,
        host: values.host.trim(),
        port: values.port,
        database: values.database.trim(),
        user: values.user.trim(),
        sslmode: values.sslmode,
        // Blank reuses the stored sidecar server-side, so "Save, then Test"
        // works without re-entering the password.
        password: values.password ? values.password : undefined,
      });
      publishResult({
        ok: res.ok,
        message: res.error || res.hint || undefined,
      });
    } catch (err) {
      publishResult({ ok: false, message: mapOrgResidencyError(err, t) });
    }
  }

  async function onClear() {
    try {
      await remove.mutateAsync({ organizationId });
      clearTestResult();
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
    // `onReset` collapses the panel: nothing is saved, so `configured` is off.
    editor.reset();
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
                    errorMessage={errors.password?.message}
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
              disabled={remove.isPending}
              isLoading={test.isPending}
            >
              {t('dataResidency.testConnection')}
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
