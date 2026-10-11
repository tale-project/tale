/**
 * Pure contract for an automation STARTER: a shipped pack-format directory
 * (`automation.yml` + `workflow.yml`) a person creates an automation from by
 * answering a few questions — the project it serves, whom it tells, when it
 * runs. Its manifest IS the pack manifest (display text, required
 * connectors, the trigger it wants) plus a `template` block: the paragraph
 * the gallery shows and the questions it asks.
 *
 * An answer is never spliced into YAML text: each question names the step
 * and the place inside it (an RFC 6901 pointer) its answer replaces, so a
 * starter's document stays the validated document it was shipped as, with
 * values swapped in. Two kinds write no document value: `project` installs
 * the automation in the project (event triggers then follow it there), and
 * `schedule` replaces the repeat rule of the starter's schedule trigger.
 */

import { z } from 'zod/v4';

import { automationPackManifestSchema } from './automation-pack';
import { catchUpSchema, timeZoneSchema } from './automation-trigger';
import { scheduleRuleSchema } from './schedule-rule';

/** The kinds of question a starter may ask. */
export const TEMPLATE_FIELD_KINDS = [
  'project',
  'member',
  'text',
  'choice',
  'schedule',
  'credential',
] as const;

export type TemplateFieldKind = (typeof TEMPLATE_FIELD_KINDS)[number];

/** The questions one starter may ask. */
export const MAX_TEMPLATE_FIELDS = 8;

/** The places one answer may be written to. */
const MAX_FIELD_WRITES = 8;

/** The longest text answer a starter may allow. */
export const MAX_TEMPLATE_TEXT_ANSWER = 2000;

const localeSchema = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/);

/** Per-locale overrides for a question's words; absent locales fall back
 * to the English top-level ones. */
const fieldI18nSchema = z.record(
  localeSchema,
  z
    .object({
      label: z.string().min(1).max(120).optional(),
      description: z.string().max(400).optional(),
      default: z.string().max(MAX_TEMPLATE_TEXT_ANSWER).optional(),
    })
    .strict(),
);

/** Where an answer goes: the step, by its id, and the place inside the
 * step as an RFC 6901 pointer (`/input/to`). The value found there in the
 * shipped document is the placeholder the answer replaces, and its shape
 * decides the answer's: a list placeholder takes a list of one. */
const fieldWriteSchema = z
  .object({
    node: z.string().min(1).max(200),
    pointer: z
      .string()
      .regex(/^(\/[^/]*)+$/, 'must be an RFC 6901 pointer such as /input/to'),
  })
  .strict();

const fieldBase = {
  /** The answer's key — camelCase, unique in the starter. */
  id: z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/),
  label: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  i18n: fieldI18nSchema.optional(),
};

const writesSchema = z.array(fieldWriteSchema).min(1).max(MAX_FIELD_WRITES);

/** One question of a starter. */
export const templateFieldSchema = z.discriminatedUnion('kind', [
  z
    .object({
      ...fieldBase,
      /** The project the automation is installed in. */
      kind: z.literal('project'),
      /** Steps that also take the project's id, such as a task to create. */
      writes: writesSchema.optional(),
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      /** A member of the organization, written as their user id. */
      kind: z.literal('member'),
      writes: writesSchema,
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      kind: z.literal('text'),
      writes: writesSchema,
      /** Blank answers are refused unless the question is optional. */
      required: z.boolean().optional(),
      default: z.string().max(MAX_TEMPLATE_TEXT_ANSWER).optional(),
      maxLength: z
        .number()
        .int()
        .min(1)
        .max(MAX_TEMPLATE_TEXT_ANSWER)
        .optional(),
      multiline: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      /** One of a fixed list of values. */
      kind: z.literal('choice'),
      writes: writesSchema,
      options: z
        .array(
          z
            .object({
              value: z.string().min(1).max(200),
              label: z.string().min(1).max(120),
              i18n: z
                .record(
                  localeSchema,
                  z.object({ label: z.string().min(1).max(120) }).strict(),
                )
                .optional(),
            })
            .strict(),
        )
        .min(2)
        .max(20),
      default: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      /** When the starter's schedule trigger runs. */
      kind: z.literal('schedule'),
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      /** A credential of `connector` in service, written by its name. */
      kind: z.literal('credential'),
      connector: z.string().min(1).max(100),
      writes: writesSchema,
    })
    .strict(),
]);

export type TemplateField = z.infer<typeof templateFieldSchema>;

/** The starter half of the manifest. */
export const templateBlockSchema = z
  .object({
    /** What the automation does and how, in a few sentences — the
     * gallery's detail pane. The manifest's `description` is the card's one
     * line. */
    details: z.string().min(1).max(2000),
    i18n: z
      .record(
        localeSchema,
        z.object({ details: z.string().max(2000).optional() }).strict(),
      )
      .optional(),
    fields: z.array(templateFieldSchema).max(MAX_TEMPLATE_FIELDS),
  })
  .strict();

export const automationTemplateManifestSchema = automationPackManifestSchema
  .extend({ template: templateBlockSchema })
  .superRefine((manifest, ctx) => {
    const fields = manifest.template.fields;
    const seen = new Set<string>();
    for (const [at, field] of fields.entries()) {
      if (seen.has(field.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `asks "${field.id}" twice`,
          path: ['template', 'fields', at, 'id'],
        });
      }
      seen.add(field.id);
    }
    for (const [at, field] of fields.entries()) {
      if (field.kind !== 'choice') continue;
      const values = field.options.map((option) => option.value);
      if (new Set(values).size !== values.length) {
        ctx.addIssue({
          code: 'custom',
          message: `offers a value of "${field.id}" twice`,
          path: ['template', 'fields', at, 'options'],
        });
      }
      if (field.default !== undefined && !values.includes(field.default)) {
        ctx.addIssue({
          code: 'custom',
          message: `"${field.id}" defaults to a value it does not offer`,
          path: ['template', 'fields', at, 'default'],
        });
      }
    }
    for (const kind of ['project', 'schedule'] as const) {
      if (fields.filter((field) => field.kind === kind).length > 1) {
        ctx.addIssue({
          code: 'custom',
          message: `asks for more than one ${kind}`,
          path: ['template', 'fields'],
        });
      }
    }
    const triggers = manifest.triggers ?? [];
    if (triggers.length > 1) {
      ctx.addIssue({
        code: 'custom',
        message: 'a starter declares one trigger at most',
        path: ['triggers'],
      });
    }
    if (
      fields.some((field) => field.kind === 'schedule') &&
      triggers[0]?.kind !== 'schedule'
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'a schedule question needs a schedule trigger to set',
        path: ['template', 'fields'],
      });
    }
    // A starter is installed where it is created; a project-scope starter
    // that asks for no project could never be.
    if (
      manifest.scope === 'project' &&
      !fields.some((field) => field.kind === 'project')
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'a project-scope starter must ask for the project',
        path: ['template', 'fields'],
      });
    }
  });

export type AutomationTemplateManifest = z.infer<
  typeof automationTemplateManifestSchema
>;

/** An answer to a schedule question, as the schedule field writes it: a
 * repeat rule or a cron expression, the zone it reads in, and what it does
 * with runs it missed. Whether the schedule can run is the trigger
 * contract's to say once it is set on the starter's trigger. */
export const scheduleAnswerSchema = z
  .object({
    repeat: scheduleRuleSchema.optional(),
    cron: z.string().max(200).optional(),
    timezone: timeZoneSchema,
    catchUp: catchUpSchema.optional(),
  })
  .strict();

/** The answers to a starter's questions, by question id: text for every
 * kind but `schedule`. */
export const templateAnswersSchema = z
  .record(
    z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/),
    z.union([z.string().max(MAX_TEMPLATE_TEXT_ANSWER), scheduleAnswerSchema]),
  )
  .refine((answers) => Object.keys(answers).length <= MAX_TEMPLATE_FIELDS, {
    message: `at most ${MAX_TEMPLATE_FIELDS} answers`,
  });

export type TemplateAnswers = z.infer<typeof templateAnswersSchema>;
