'use client';

/**
 * The editing state of one automation's declared settings — shared by the two
 * surfaces that present them: the create-task gate (stacked, one
 * "Save and continue") and the settings dialog (tabbed, one Save).
 *
 * The DECLARATION comes from the automation version; the VALUES live in the
 * project's settings folder as flat-YAML files, one per declared form, so the
 * same automation configures independently per project. Only the operator's
 * EDITS are state here; everything else derives from the files, which means no
 * load effect and a saved file's refetch settles the editor back to clean on
 * its own.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type {
  AutomationSettings,
  SettingsField,
  SettingsForm,
} from '@/lib/shared/schemas/automation_settings';

import {
  settingsValuesQueryKey,
  useAutomationSettingsValues,
} from './use-settings-values';

/** Which rule a field's current value breaks, if any. */
export type SettingsFieldIssue = 'required' | 'number' | 'pattern';

/** Per-file value maps, keyed by the form's file name. */
type ValuesByFile = Record<string, Record<string, string>>;

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

/** One field's issue, or null. Mirrors the declaration's own rules; a broken
 * pattern fails OPEN like the contract's naming gate — a bad declaration must
 * not brick the form. */
export function fieldIssue(
  field: SettingsField,
  raw: string,
): SettingsFieldIssue | null {
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

/** What a save did: the files written, or which forms refused validation. */
export type SettingsSaveResult =
  | { ok: true; written: string[] }
  | { ok: false; invalidFiles: string[] };

export interface SettingsEditor {
  /** The declared forms, in declaration order. */
  forms: readonly SettingsForm[];
  pending: boolean;
  failed: boolean;
  saving: boolean;
  /** The values a form's controls show: the file, the defaults, the edits. */
  valuesOf: (file: string) => Record<string, string>;
  issueOf: (file: string, key: string) => SettingsFieldIssue | null;
  setField: (file: string, key: string, value: string) => void;
  /** This form has edits the file does not have yet. */
  isDirty: (file: string) => boolean;
  /** Files with unsaved edits — what a single Save would write. */
  dirtyFiles: string[];
  /**
   * Validate `validate`, then write `write`. A refusal names the offending
   * files IN THE RESULT rather than leaving the caller to read them back off
   * the editor: the caller's `editor` is the closure from the render that
   * started the save, so its issues are always one render stale.
   *
   * The two lists differ on purpose. First-time setup writes every form even
   * where the operator accepted the defaults (the files do not exist yet); the
   * settings dialog writes only what changed, but still validates everything,
   * because a required field left empty in an untouched form must not be saved
   * around.
   */
  save: (args: {
    write: readonly SettingsForm[];
    validate: readonly SettingsForm[];
  }) => Promise<SettingsSaveResult>;
}

export function useSettingsEditor({
  organizationId,
  projectId,
  settings,
  folder,
}: {
  organizationId: string;
  projectId: Id<'projects'>;
  settings: AutomationSettings;
  folder: string;
}): SettingsEditor {
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

  const [edited, setEdited] = useState<ValuesByFile>({});
  // Issues appear on save attempts, never while typing a form for the first
  // time; a change to the offending field clears its issue immediately.
  const [issues, setIssues] = useState<
    Record<string, Record<string, SettingsFieldIssue>>
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

  const isDirty = (file: string): boolean => {
    const form = settings.forms.find((entry) => entry.file === file);
    if (form === undefined) return false;
    const current = yamlOf(form, valuesOf(file));
    const onDisk = yamlOf(form, fromFiles[file] ?? {});
    const keys = new Set([...Object.keys(current), ...Object.keys(onDisk)]);
    return [...keys].some((key) => current[key] !== onDisk[key]);
  };

  const setField = (file: string, key: string, value: string) => {
    setEdited((prev) => ({ ...prev, [file]: { ...prev[file], [key]: value } }));
    setIssues((prev) => {
      const forFile = prev[file];
      if (forFile?.[key] === undefined) return prev;
      const { [key]: _cleared, ...rest } = forFile;
      return { ...prev, [file]: rest };
    });
  };

  const writeForm = async (form: SettingsForm): Promise<void> => {
    await writeValues.mutateAsync({
      organizationId,
      projectId,
      folderName: folder,
      fileName: form.file,
      yaml: yamlOf(form, valuesOf(form.file)),
    });
    // Drop this form's edits: the file is now the source of truth again, so the
    // controls derive back to clean without tracking a baseline.
    setEdited((prev) => {
      const { [form.file]: _saved, ...rest } = prev;
      return rest;
    });
  };

  const save = async ({
    write,
    validate,
  }: {
    write: readonly SettingsForm[];
    validate: readonly SettingsForm[];
  }): Promise<SettingsSaveResult> => {
    if (saving) return { ok: false, invalidFiles: [] };
    const found: Record<string, Record<string, SettingsFieldIssue>> = {};
    for (const form of validate) {
      const values = valuesOf(form.file);
      for (const field of form.fields) {
        const issue = fieldIssue(field, values[field.key] ?? '');
        if (issue !== null) {
          found[form.file] = { ...found[form.file], [field.key]: issue };
        }
      }
    }
    setIssues(found);
    const invalidFiles = Object.keys(found);
    if (invalidFiles.length > 0) return { ok: false, invalidFiles };

    setSaving(true);
    try {
      const written: string[] = [];
      // Sequential on purpose: the files share one folder, and the first write
      // is the one that may create it.
      for (const form of write) {
        await writeForm(form);
        written.push(form.file);
      }
      await queryClient.invalidateQueries({
        queryKey: settingsValuesQueryKey(organizationId, projectId, folder),
      });
      return { ok: true, written };
    } finally {
      setSaving(false);
    }
  };

  return {
    forms: settings.forms,
    pending: stored.isPending,
    failed: stored.isError,
    saving,
    valuesOf,
    issueOf: (file, key) => issues[file]?.[key] ?? null,
    setField,
    isDirty,
    dirtyFiles: settings.forms
      .map((form) => form.file)
      .filter((file) => isDirty(file)),
    save,
  };
}
