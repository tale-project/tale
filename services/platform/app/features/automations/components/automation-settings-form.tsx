'use client';

import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Input } from '@/app/components/ui/forms/input';
import { Select } from '@/app/components/ui/forms/select';
import { useConvexAction } from '@/app/hooks/use-convex-action';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import type {
  AutomationSettings,
  SettingsField,
  SettingsForm,
} from '@/lib/shared/schemas/automation_settings';

import {
  settingsValuesQueryKey,
  useAutomationSettingsValues,
} from '../hooks/use-settings-values';

/**
 * The declared settings of one automation, rendered as forms over the flat-
 * YAML files they own (`documents/public_actions` read/write twins). The
 * DECLARATION comes from the automation version; the VALUES live in the
 * project's settings folder, so the same automation configures independently
 * per project.
 *
 * Two modes:
 *  - `setup`: one primary "Save and continue" writes every form — the
 *    create-task gate mounts this when a required file is still missing.
 *  - `edit`: each form saves alone, dirty-gated, like any settings panel.
 */
export interface AutomationSettingsFormProps {
  organizationId: string;
  projectId: Id<'projects'>;
  settings: AutomationSettings;
  /** Resolved target folder (see `resolveSettingsFolder`). */
  folder: string;
  mode: 'setup' | 'edit';
  /** Setup mode: called once every form has been written. */
  onSaved?: () => void;
}

/** Per-file value maps, keyed by the form's file name. */
type ValuesByFile = Record<string, Record<string, string>>;

/** Locale resolution for declared text: exact tag wins over base language
 * over the authored (English) field — same chain the task contract uses. */
function useLocalized() {
  const { locale } = useLocale();
  const base = locale.split('-')[0] ?? locale;
  return useMemo(
    () =>
      function localized<T extends object>(
        entity: T & { i18n?: Record<string, Partial<T>> },
      ): T {
        const { i18n, ...rest } = entity;
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- rest is T minus i18n; the overrides are Partial<T>
        return { ...rest, ...i18n?.[base], ...i18n?.[locale] } as T;
      },
    [base, locale],
  );
}

/** Initial value of one field: the file's value, else the declared default,
 * else the type's empty ('false' for booleans so the control is determinate). */
function initialValue(
  field: SettingsField,
  fromFile: Record<string, string>,
): string {
  const stored = fromFile[field.key];
  if (stored !== undefined && stored.trim() !== '') return stored;
  if (field.default !== undefined) return field.default;
  return field.type === 'boolean' ? 'false' : '';
}

/** The YAML map a save writes: every non-empty value; empty optional fields
 * stay out of the file so packs can tell "unset" from "blank". */
function yamlOf(
  form: SettingsForm,
  values: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of form.fields) {
    const value = (values[field.key] ?? '').trim();
    if (value === '') continue;
    out[field.key] = value;
  }
  return out;
}

/** Validation message key for one field's current value, or null. Mirrors the
 * declaration's own rules; a broken pattern fails OPEN like the contract's
 * naming gate — a bad declaration must not brick the form. */
function fieldIssue(
  field: SettingsField,
  raw: string,
): 'required' | 'number' | 'pattern' | null {
  const value = raw.trim();
  if (value === '') return field.required === true ? 'required' : null;
  if (field.type === 'number' && !Number.isFinite(Number(value))) {
    return 'number';
  }
  if (field.type === 'text' && field.pattern !== undefined) {
    try {
      if (!new RegExp(field.pattern).test(value)) return 'pattern';
    } catch (error) {
      console.warn(
        '[automations] invalid settings field pattern',
        field.pattern,
        error,
      );
    }
  }
  return null;
}

function SettingsFieldControl({
  form,
  field,
  value,
  issue,
  disabled,
  onChange,
}: {
  form: SettingsForm;
  field: SettingsField;
  value: string;
  issue: 'required' | 'number' | 'pattern' | null;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useT('automations');
  const localized = useLocalized();
  const text = localized(field);
  const id = `automation-settings-${form.file}-${field.key}`;
  const errorMessage =
    issue === null ? undefined : t(`settings.errors.${issue}`);

  if (field.type === 'boolean') {
    return (
      <Checkbox
        id={id}
        label={text.label}
        {...(text.help !== undefined && { description: text.help })}
        checked={value === 'true'}
        onCheckedChange={(checked) =>
          onChange(checked === true ? 'true' : 'false')
        }
        disabled={disabled}
      />
    );
  }
  if (field.type === 'select') {
    const options = (field.options ?? []).map((option) => ({
      value: option.value,
      label: localized(option).label,
    }));
    return (
      <Select
        id={id}
        label={text.label}
        options={options}
        value={value === '' ? undefined : value}
        onValueChange={onChange}
        {...(text.placeholder !== undefined && {
          placeholder: text.placeholder,
        })}
        {...(text.help !== undefined && { description: text.help })}
        required={field.required === true}
        error={issue !== null}
        disabled={disabled}
      />
    );
  }
  return (
    <Input
      id={id}
      label={text.label}
      type={field.type === 'number' ? 'number' : 'text'}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      {...(text.placeholder !== undefined && {
        placeholder: text.placeholder,
      })}
      {...(text.help !== undefined && { description: text.help })}
      {...(errorMessage !== undefined && { errorMessage })}
      required={field.required === true}
      disabled={disabled}
    />
  );
}

export function AutomationSettingsForm({
  organizationId,
  projectId,
  settings,
  folder,
  mode,
  onSaved,
}: AutomationSettingsFormProps) {
  const { t } = useT('automations');
  const localized = useLocalized();
  const queryClient = useQueryClient();
  const stored = useAutomationSettingsValues(
    organizationId,
    projectId,
    folder,
    settings,
  );
  const writeValues = useConvexAction(
    api.documents.public_actions.ensureProjectTextDocument,
  );

  // Only the user's EDITS are state; everything else derives from the files.
  // Deriving instead of syncing means no load effect, and a saved file's
  // refetch settles the form back to clean on its own.
  const [edited, setEdited] = useState<ValuesByFile>({});
  // Issues appear on save attempts, never while typing a form for the first
  // time; a change to the offending field clears its issue immediately.
  const [issues, setIssues] = useState<
    Record<string, Record<string, 'required' | 'number' | 'pattern'>>
  >({});
  // Which form is saving is nobody's business — every control locks while a
  // write is in flight, so the state is the fact itself.
  const [saving, setSaving] = useState(false);

  // What a save would write if nobody had typed: the file's values with the
  // declaration's defaults applied. It is also the clean baseline — a boolean
  // materializing 'false' or a default prefilling must not read as an edit.
  const fromFiles = useMemo(() => {
    const out: ValuesByFile = {};
    for (const form of settings.forms) {
      const file = stored.data?.[form.file] ?? {};
      out[form.file] = Object.fromEntries(
        form.fields.map((field) => [field.key, initialValue(field, file)]),
      );
    }
    return out;
  }, [settings, stored.data]);

  const valuesOf = (file: string): Record<string, string> => ({
    ...fromFiles[file],
    ...edited[file],
  });

  const setField = (file: string, key: string, value: string) => {
    setEdited((prev) => ({
      ...prev,
      [file]: { ...prev[file], [key]: value },
    }));
    setIssues((prev) => {
      const forFile = prev[file];
      if (forFile?.[key] === undefined) return prev;
      const { [key]: _cleared, ...rest } = forFile;
      return { ...prev, [file]: rest };
    });
  };

  const validateForms = (forms: readonly SettingsForm[]): boolean => {
    const found: typeof issues = {};
    for (const form of forms) {
      const values = valuesOf(form.file);
      for (const field of form.fields) {
        const issue = fieldIssue(field, values[field.key] ?? '');
        if (issue !== null) {
          found[form.file] = { ...found[form.file], [field.key]: issue };
        }
      }
    }
    setIssues(found);
    return Object.keys(found).length === 0;
  };

  const writeForm = async (form: SettingsForm): Promise<void> => {
    await writeValues.mutateAsync({
      organizationId,
      projectId,
      folderName: folder,
      fileName: form.file,
      yaml: yamlOf(form, valuesOf(form.file)),
    });
    // Drop this form's edits and refetch: the file is now the source of truth
    // again, so the form derives back to clean without tracking a baseline.
    setEdited((prev) => {
      const { [form.file]: _saved, ...rest } = prev;
      return rest;
    });
    await queryClient.invalidateQueries({
      queryKey: settingsValuesQueryKey(organizationId, projectId, folder),
    });
  };

  const saveOne = async (form: SettingsForm) => {
    if (saving || !validateForms([form])) return;
    setSaving(true);
    try {
      await writeForm(form);
      toast({ title: t('settings.saved'), variant: 'success' });
    } catch (error) {
      console.error('[automations] settings save failed', error);
      toast({ title: t('settings.saveFailed'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const saveAll = async () => {
    if (saving || !validateForms(settings.forms)) return;
    setSaving(true);
    try {
      // Sequential on purpose: the files share one folder, and the first
      // write is the one that may create it.
      for (const form of settings.forms) {
        await writeForm(form);
      }
      onSaved?.();
    } catch (error) {
      console.error('[automations] settings save failed', error);
      toast({ title: t('settings.saveFailed'), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const dirty = (form: SettingsForm): boolean => {
    const current = yamlOf(form, valuesOf(form.file));
    const onDisk = yamlOf(form, fromFiles[form.file] ?? {});
    const keys = new Set([...Object.keys(current), ...Object.keys(onDisk)]);
    return [...keys].some((key) => current[key] !== onDisk[key]);
  };

  if (stored.isPending) {
    return (
      <Text as="p" variant="muted">
        {t('settings.loading')}
      </Text>
    );
  }
  if (stored.isError) {
    console.error('[automations] settings read failed', stored.error);
    return (
      <Text as="p" variant="muted">
        {t('settings.loadFailed')}
      </Text>
    );
  }

  return (
    <Stack gap={6}>
      {settings.forms.map((form) => {
        const text = localized(form);
        const values = valuesOf(form.file);
        return (
          <Stack key={form.file} gap={3}>
            <Stack gap={1}>
              <Text as="h3" className="text-sm font-medium">
                {text.title}
              </Text>
              {text.description !== undefined && (
                <Text as="p" variant="muted">
                  {text.description}
                </Text>
              )}
            </Stack>
            {form.fields.map((field) => (
              <SettingsFieldControl
                key={field.key}
                form={form}
                field={field}
                value={values[field.key] ?? ''}
                issue={issues[form.file]?.[field.key] ?? null}
                disabled={saving}
                onChange={(value) => setField(form.file, field.key, value)}
              />
            ))}
            {mode === 'edit' && (
              <Row justify="end">
                <Button
                  size="sm"
                  onClick={() => void saveOne(form)}
                  disabled={saving || !dirty(form)}
                >
                  {t('settings.save')}
                </Button>
              </Row>
            )}
          </Stack>
        );
      })}
      {mode === 'setup' && (
        <Row justify="end">
          <Button onClick={() => void saveAll()} disabled={saving}>
            {t('settings.saveAndContinue')}
          </Button>
        </Row>
      )}
    </Stack>
  );
}
