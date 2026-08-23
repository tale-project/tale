/**
 * The automation's SETTINGS declaration — operator-editable configuration the
 * platform renders as forms and persists as flat-YAML text files in a project
 * folder (`documents/public_actions:ensureProjectTextDocument` and its read
 * twin). Packs declare WHAT is configurable; the platform stays
 * product-agnostic and only ever writes the declared files.
 *
 * Like the task-surface contract it travels with the automation VERSION in
 * the store (seeded from a pack's `automation.yml settings:` block or the
 * builder's save), and the task surfaces consume the DEPLOYED version's
 * declaration: the create-task template gates on the `required` forms until
 * their files carry every required key, and offers the same forms for editing
 * afterwards.
 *
 * Custody rule: a declared settings file is FORM-OWNED — a save rewrites the
 * whole file from the form's values. Anything richer than a flat string map
 * (nested blocks, lists, co-authored files) belongs in OTHER files the pack
 * merges at run time, never in a declared settings file.
 */

import { z } from 'zod/v4';

import type { TaskSubjectContract } from './task_contract';

/** Fallback project folder for settings files when neither the settings block
 * nor the task contract names one. */
const DEFAULT_SETTINGS_FOLDER = 'Setup';

/** Keys must survive `serializeYamlMap` (its own KEY_RE, mirrored here). */
const FIELD_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Locale keys accepted by the per-entry i18n channels (same grammar as the
 * pack manifest's top-level i18n block). */
const LOCALE_RE = /^[a-z]{2}(-[A-Z]{2})?$/;

const localizedFieldTextSchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    placeholder: z.string().max(200).optional(),
    help: z.string().max(500).optional(),
  })
  .strict();

const localizedOptionTextSchema = z
  .object({ label: z.string().min(1).max(200).optional() })
  .strict();

const localizedFormTextSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
  })
  .strict();

const settingsFieldOptionSchema = z
  .object({
    /** The stored value — written verbatim into the YAML map. */
    value: z.string().min(1).max(200),
    /** English display label; locales override via `i18n`. */
    label: z.string().min(1).max(200),
    i18n: z
      .record(z.string().regex(LOCALE_RE), localizedOptionTextSchema)
      .optional(),
  })
  .strict();

export const settingsFieldSchema = z
  .object({
    /** YAML map key the value is stored under. */
    key: z.string().regex(FIELD_KEY_RE, {
      message:
        'must be a bare YAML key (letters, digits, underscores; not starting with a digit)',
    }),
    label: z.string().min(1).max(200),
    /** All values are stored as strings; the type drives the control and the
     * client-side validation (`boolean` stores 'true'/'false'). */
    type: z.enum(['text', 'number', 'boolean', 'select']),
    required: z.boolean().optional(),
    /** Anchored regex a `text` value must match (e.g. an identifier shape). */
    pattern: z.string().max(500).optional(),
    /** Prefill when the file carries no value yet, in string form. */
    default: z.string().max(500).optional(),
    placeholder: z.string().max(200).optional(),
    help: z.string().max(500).optional(),
    /** Choices for `select`. */
    options: z.array(settingsFieldOptionSchema).min(1).max(20).optional(),
    i18n: z
      .record(z.string().regex(LOCALE_RE), localizedFieldTextSchema)
      .optional(),
  })
  .strict()
  .check((ctx) => {
    const field = ctx.value;
    if (field.type === 'select') {
      if (field.options === undefined) {
        ctx.issues.push({
          code: 'custom',
          message: 'a select field needs options',
          input: field,
          path: ['options'],
        });
      } else if (
        field.default !== undefined &&
        !field.options.some((option) => option.value === field.default)
      ) {
        ctx.issues.push({
          code: 'custom',
          message: 'default must be one of the option values',
          input: field,
          path: ['default'],
        });
      }
    } else if (field.options !== undefined) {
      ctx.issues.push({
        code: 'custom',
        message: 'only select fields take options',
        input: field,
        path: ['options'],
      });
    }
    if (field.type !== 'text' && field.pattern !== undefined) {
      ctx.issues.push({
        code: 'custom',
        message: 'only text fields take a pattern',
        input: field,
        path: ['pattern'],
      });
    }
    if (field.pattern !== undefined) {
      try {
        new RegExp(field.pattern);
      } catch {
        ctx.issues.push({
          code: 'custom',
          message: 'pattern is not a valid regular expression',
          input: field,
          path: ['pattern'],
        });
      }
    }
    if (
      field.type === 'boolean' &&
      field.default !== undefined &&
      field.default !== 'true' &&
      field.default !== 'false'
    ) {
      ctx.issues.push({
        code: 'custom',
        message: "a boolean default is 'true' or 'false'",
        input: field,
        path: ['default'],
      });
    }
    if (
      field.type === 'number' &&
      field.default !== undefined &&
      !Number.isFinite(Number(field.default))
    ) {
      ctx.issues.push({
        code: 'custom',
        message: 'a number default must be numeric',
        input: field,
        path: ['default'],
      });
    }
  });

export const settingsFormSchema = z
  .object({
    /** File name inside the settings folder (no path separators). */
    file: z
      .string()
      .min(1)
      .max(100)
      .refine(
        (name) =>
          !name.includes('/') && !name.includes('\\') && !name.includes('..'),
        { message: 'file must be a bare file name' },
      ),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    /** Required forms gate the create-task template until their file carries
     * every required field key. */
    required: z.boolean().optional(),
    fields: z
      .array(settingsFieldSchema)
      .min(1)
      .max(30)
      .refine(
        (fields) => new Set(fields.map((f) => f.key)).size === fields.length,
        { message: 'field keys must be unique within a form' },
      ),
    i18n: z
      .record(z.string().regex(LOCALE_RE), localizedFormTextSchema)
      .optional(),
  })
  .strict();

/**
 * The second form shape: an UPLOADS panel — the operator drops files into the
 * settings folder instead of filling fields. Packs whose runs consume
 * operator-provided documents (reference PDFs, prior filings) declare one so
 * the operator never has to know which project folder the files live in.
 * Uploads apply immediately (no Save, no dirty state) and never gate task
 * creation.
 */
export const settingsUploadsFormSchema = z
  .object({
    kind: z.literal('uploads'),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    /** Extensions the picker accepts (with the dot, e.g. '.pdf'). */
    accept: z
      .array(z.string().regex(/^\.[a-z0-9]+$/i))
      .min(1)
      .max(10),
    /** Regex over file names, matched case-insensitively — folder files
     * matching it are listed as this panel's uploads (the folder may also
     * hold unrelated setup files). */
    match: z.string().min(1).max(500),
    /** Require picking (or creating) a subfolder before uploading — the
     * drop zone only appears with a folder selected. For packs whose files
     * must stay organised per period/topic rather than piling up at the
     * panel root. */
    requireFolder: z.boolean().optional(),
    /** Subfolder of the settings folder the uploads live in (e.g.
     * 'filed-returns'). The panel uploads INTO it and lists its whole
     * subtree, so the operator may organise deeper (per-quarter) folders
     * inside it by hand. Omitted = the settings folder itself. */
    subdir: z
      .string()
      .min(1)
      .max(100)
      .refine(
        (name) =>
          !name.includes('/') && !name.includes('\\') && !name.includes('..'),
        { message: 'subdir must be a bare folder name' },
      )
      .optional(),
    i18n: z
      .record(z.string().regex(LOCALE_RE), localizedFormTextSchema)
      .optional(),
  })
  .strict()
  .check((ctx) => {
    try {
      new RegExp(ctx.value.match);
    } catch {
      ctx.issues.push({
        code: 'custom',
        message: 'match is not a valid regular expression',
        input: ctx.value,
        path: ['match'],
      });
    }
  });

const anySettingsFormSchema = z.union([
  settingsUploadsFormSchema,
  settingsFormSchema,
]);

export const automationSettingsSchema = z
  .object({
    /** Top-level project folder the files live in; defaults to the task
     * contract's `input.setupFolderName`, then {@link DEFAULT_SETTINGS_FOLDER}. */
    folder: z.string().min(1).max(100).optional(),
    forms: z
      .array(anySettingsFormSchema)
      .min(1)
      .max(10)
      .refine(
        (forms) => {
          const files = forms.flatMap((f) => ('kind' in f ? [] : [f.file]));
          return new Set(files).size === files.length;
        },
        { message: 'each form must target a distinct file' },
      ),
  })
  .strict();

export type AutomationSettings = z.infer<typeof automationSettingsSchema>;
export type SettingsForm = z.infer<typeof settingsFormSchema>;
export type SettingsUploadsForm = z.infer<typeof settingsUploadsFormSchema>;
export type AnySettingsForm = z.infer<typeof anySettingsFormSchema>;
export type SettingsField = z.infer<typeof settingsFieldSchema>;

/** The uploads-panel variant; its complement narrows to {@link SettingsForm}. */
export function isUploadsForm(
  form: AnySettingsForm,
): form is SettingsUploadsForm {
  return 'kind' in form && form.kind === 'uploads';
}

/** The field-form variant — the one with a file, values, and a save. */
export function isFieldsForm(form: AnySettingsForm): form is SettingsForm {
  return !isUploadsForm(form);
}

/** Tolerant read of a stored declaration: an unparsable value reads as none —
 * the surfaces then treat the automation as settings-less rather than failing
 * to render (mirror of `parseTaskSubjectContract`). */
export function parseAutomationSettings(
  value: unknown,
): AutomationSettings | null {
  const parsed = automationSettingsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** The one folder every settings surface resolves — declaration first, then
 * the task contract's setup folder, then the default. */
export function resolveSettingsFolder(
  settings: AutomationSettings,
  contract?: Pick<TaskSubjectContract, 'input'> | null,
): string {
  return (
    settings.folder ??
    contract?.input?.setupFolderName ??
    DEFAULT_SETTINGS_FOLDER
  );
}

/** Whether a form's file, read back as a flat map, satisfies the form — every
 * REQUIRED field key present and non-empty. The create-task gate uses this
 * (presence, not format: a hand-edited odd value must not brick creation). */
export function settingsFormSatisfied(
  form: SettingsForm,
  values: Record<string, string>,
): boolean {
  return form.fields.every(
    (field) =>
      field.required !== true || (values[field.key] ?? '').trim() !== '',
  );
}
