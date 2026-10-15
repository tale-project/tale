/**
 * Pure contract for an automation TEMPLATE: a shipped pack-format directory
 * (`automation.yml` + `workflow.yml`) a person creates an automation from by
 * answering a few questions — the project it serves, whom it tells, when it
 * runs. Its manifest IS the pack manifest (display text, category, icon,
 * required connectors, the trigger it wants) plus a `template` block: what
 * the catalog's preview says — the paragraph, the steps in order, what it
 * changes, the templates it works with — and the questions it asks.
 *
 * An answer is never spliced into YAML text: each question names the place
 * its answer replaces — a step by its id or the template's trigger, and an
 * RFC 6901 pointer inside it — so a template's document stays the validated
 * document it was shipped as, with values swapped in. Two kinds need no
 * place: `project` installs the automation in the project (event triggers
 * then follow it there), and `schedule` replaces the repeat rule of the
 * template's schedule trigger.
 */

import { z } from 'zod/v4';

import {
  automationCategorySchema,
  automationPackManifestSchema,
} from './automation-pack';
import { catchUpSchema, timeZoneSchema } from './automation-trigger';
import { scheduleRuleSchema } from './schedule-rule';

/** The kinds of question a template may ask. */
export const TEMPLATE_FIELD_KINDS = [
  'project',
  'member',
  'text',
  'choice',
  'schedule',
  'credential',
  'number',
  'toggle',
  'list',
] as const;

export type TemplateFieldKind = (typeof TEMPLATE_FIELD_KINDS)[number];

/** The questions one template may ask. */
export const MAX_TEMPLATE_FIELDS = 8;

/** The places one answer may be written to. */
const MAX_FIELD_WRITES = 8;

/** The longest text answer a template may allow. */
export const MAX_TEMPLATE_TEXT_ANSWER = 2000;

/** The most items a list question may take. */
export const MAX_TEMPLATE_LIST_ITEMS = 50;

/** The longest item a list question may take. */
export const MAX_TEMPLATE_LIST_ITEM = 200;

/** The items a list question takes when it names no `maxItems`. */
export const DEFAULT_LIST_ITEMS = 20;

/** The longest item a list question takes when it names no
 * `itemMaxLength`. */
export const DEFAULT_LIST_ITEM_LENGTH = 100;

/** The steps a template's "how it works" may list. */
export const MAX_TEMPLATE_STEPS = 8;

/** The outcomes a template's "what it changes" may list. */
export const MAX_TEMPLATE_OUTCOMES = 6;

/** The templates one template may say it works with. */
const MAX_WORKS_WITH = 3;

/** The largest magnitude a number question may take. */
const MAX_TEMPLATE_NUMBER = 1_000_000_000;

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
      placeholder: z.string().min(1).max(120).optional(),
    })
    .strict(),
);

const pointerSchema = z
  .string()
  .regex(/^(\/[^/]*)+$/, 'must be an RFC 6901 pointer such as /input/to');

/** Where an answer goes: a step, by its id, or the template's one trigger,
 * and the place inside it as an RFC 6901 pointer (`/input/to`). A trigger
 * takes an answer only in its fixed input (`/input/owner`), which every run
 * it starts receives. The value found there in the shipped document is the
 * placeholder the answer replaces, and its shape decides the answer's: a
 * list placeholder takes a list (a text answer as a list of one), a text
 * placeholder takes a list's items joined with ", ". */
const fieldWriteSchema = z.union([
  z
    .object({
      node: z.string().min(1).max(200),
      pointer: pointerSchema,
    })
    .strict(),
  z
    .object({
      trigger: z.literal(true),
      pointer: pointerSchema.refine(
        (pointer) => pointer.startsWith('/input/'),
        {
          message:
            'a trigger takes an answer only in its fixed input: /input/<key>',
        },
      ),
    })
    .strict(),
]);

export type TemplateFieldWrite = z.infer<typeof fieldWriteSchema>;

/** Whether `source` compiles as a regular expression. */
function compiles(source: string): boolean {
  try {
    return new RegExp(source, 'u').source !== '';
  } catch {
    // The refusal is the answer: the schema reports the pattern.
    return false;
  }
}

const integerSchema = z
  .number()
  .int()
  .min(-MAX_TEMPLATE_NUMBER)
  .max(MAX_TEMPLATE_NUMBER);

const fieldBase = {
  /** The answer's key — camelCase, unique in the template. */
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
      /** An example shown in the empty input, never written. */
      placeholder: z.string().min(1).max(120).optional(),
      /** The form an answer must have, as a regular expression the whole
       * trimmed answer matches (`^[\w.-]+$`). */
      pattern: z
        .string()
        .min(1)
        .max(200)
        .refine(compiles, { message: 'is not a regular expression' })
        .optional(),
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
      /** Blank answers are refused unless the question is optional; a
       * blank optional answer writes nothing. */
      required: z.boolean().optional(),
      /** What the empty choice of an optional question means here — "Every
       * connected Gmail mailbox", "The default GitHub connection" — shown as
       * that choice's label; the catalog suite asks one of every optional
       * credential question. */
      placeholder: z.string().min(1).max(120).optional(),
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      /** A whole number between `min` and `max` — every count that sizes a
       * run is bounded. */
      kind: z.literal('number'),
      writes: writesSchema,
      min: integerSchema,
      max: integerSchema,
      default: integerSchema.optional(),
      /** A blank answer takes the default; with none it is refused unless
       * the question is optional, and an optional one writes nothing. */
      required: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      /** On or off, written as a boolean; off unless `default` says on. */
      kind: z.literal('toggle'),
      writes: writesSchema,
      default: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      ...fieldBase,
      /** A few short texts — labels, addresses — written as a list, or
       * joined with ", " where the placeholder is text. Items are trimmed;
       * blank and repeated ones are dropped. */
      kind: z.literal('list'),
      writes: writesSchema,
      maxItems: z.number().int().min(1).max(MAX_TEMPLATE_LIST_ITEMS).optional(),
      itemMaxLength: z
        .number()
        .int()
        .min(1)
        .max(MAX_TEMPLATE_LIST_ITEM)
        .optional(),
      default: z
        .array(z.string().min(1).max(MAX_TEMPLATE_LIST_ITEM))
        .max(MAX_TEMPLATE_LIST_ITEMS)
        .optional(),
      /** An empty list is an answer unless the question is required. */
      required: z.boolean().optional(),
      placeholder: z.string().min(1).max(120).optional(),
    })
    .strict(),
]);

export type TemplateField = z.infer<typeof templateFieldSchema>;

/** One step of a template's "how it works", in the order the run takes
 * them — a reader's account of the run, not its node list. */
const templateStepSchema = z
  .object({
    title: z.string().min(1).max(80),
    detail: z.string().min(1).max(300).optional(),
    i18n: z
      .record(
        localeSchema,
        z
          .object({
            title: z.string().min(1).max(80).optional(),
            detail: z.string().min(1).max(300).optional(),
          })
          .strict(),
      )
      .optional(),
  })
  .strict();

export type TemplateStep = z.infer<typeof templateStepSchema>;

/** What an outcome does: makes something new, changes something that
 * exists, tells someone — or, `never`, a promise of what it leaves alone. */
export const TEMPLATE_OUTCOME_KINDS = [
  'creates',
  'changes',
  'sends',
  'never',
] as const;

export type TemplateOutcomeKind = (typeof TEMPLATE_OUTCOME_KINDS)[number];

/** One line of a template's "what it changes". */
const templateOutcomeSchema = z
  .object({
    kind: z.enum(TEMPLATE_OUTCOME_KINDS),
    text: z.string().min(1).max(160),
    i18n: z
      .record(
        localeSchema,
        z.object({ text: z.string().min(1).max(160) }).strict(),
      )
      .optional(),
  })
  .strict();

export type TemplateOutcome = z.infer<typeof templateOutcomeSchema>;

/** A catalog slug: the template's directory below its catalog root. */
const catalogSlugSchema = z
  .string()
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*){0,3}$/,
    'must be a catalog slug such as gmail/sync-emails',
  );

/** The template half of the manifest. */
export const templateBlockSchema = z
  .object({
    /** What the automation does and how, in a few sentences — the
     * preview's lead. The manifest's `description` is the card's one
     * line. */
    details: z.string().min(1).max(2000),
    i18n: z
      .record(
        localeSchema,
        z.object({ details: z.string().max(2000).optional() }).strict(),
      )
      .optional(),
    /** How it works, in order. */
    steps: z.array(templateStepSchema).min(1).max(MAX_TEMPLATE_STEPS),
    /** What it creates, changes or sends, and what it never does. */
    outcomes: z.array(templateOutcomeSchema).min(1).max(MAX_TEMPLATE_OUTCOMES),
    /** Templates it works with — a triage beside the sync that fills its
     * inbox — by catalog slug. */
    worksWith: z.array(catalogSlugSchema).min(1).max(MAX_WORKS_WITH).optional(),
    fields: z.array(templateFieldSchema).max(MAX_TEMPLATE_FIELDS),
  })
  .strict();

export type TemplateBlock = z.infer<typeof templateBlockSchema>;

type TemplateCheckContext = Parameters<
  Parameters<typeof automationPackManifestSchema.superRefine>[0]
>[1];

/** What a template must hold beyond each key's own shape: unique
 * questions, defaults its questions can take, one project and one schedule
 * at most, a trigger for every question that sets one, and something it
 * does besides what it promises not to. */
function checkTemplate(
  manifest: {
    scope?: 'org' | 'project' | undefined;
    triggers?: readonly { kind: string }[] | undefined;
    template: TemplateBlock;
  },
  ctx: TemplateCheckContext,
): void {
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
    const path = ['template', 'fields', at];
    if (field.kind === 'choice') {
      const values = field.options.map((option) => option.value);
      if (new Set(values).size !== values.length) {
        ctx.addIssue({
          code: 'custom',
          message: `offers a value of "${field.id}" twice`,
          path: [...path, 'options'],
        });
      }
      if (field.default !== undefined && !values.includes(field.default)) {
        ctx.addIssue({
          code: 'custom',
          message: `"${field.id}" defaults to a value it does not offer`,
          path: [...path, 'default'],
        });
      }
    }
    if (field.kind === 'number') {
      if (field.min > field.max) {
        ctx.addIssue({
          code: 'custom',
          message: `"${field.id}" has a minimum above its maximum`,
          path: [...path, 'min'],
        });
      }
      if (
        field.default !== undefined &&
        (field.default < field.min || field.default > field.max)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: `"${field.id}" defaults to a number outside its bounds`,
          path: [...path, 'default'],
        });
      }
    }
    if (field.kind === 'list' && field.default !== undefined) {
      const maxItems = field.maxItems ?? DEFAULT_LIST_ITEMS;
      const itemMax = field.itemMaxLength ?? DEFAULT_LIST_ITEM_LENGTH;
      if (
        field.default.length > maxItems ||
        field.default.some((item) => item.length > itemMax)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: `"${field.id}" defaults to a list it would refuse`,
          path: [...path, 'default'],
        });
      }
    }
    if (
      field.kind === 'text' &&
      field.default !== undefined &&
      field.default.length > (field.maxLength ?? MAX_TEMPLATE_TEXT_ANSWER)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `"${field.id}" defaults to a text longer than it takes`,
        path: [...path, 'default'],
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
      message: 'a template declares one trigger at most',
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
  if (
    triggers.length === 0 &&
    fields.some(
      (field) =>
        'writes' in field &&
        field.writes?.some((write) => 'trigger' in write) === true,
    )
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'a question writes into a trigger the template does not declare',
      path: ['template', 'fields'],
    });
  }
  // A template is installed where it is created; a project-scope template
  // that asks for no project could never be.
  if (
    manifest.scope === 'project' &&
    !fields.some((field) => field.kind === 'project')
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'a project-scope template must ask for the project',
      path: ['template', 'fields'],
    });
  }
  if (manifest.template.outcomes.every((outcome) => outcome.kind === 'never')) {
    ctx.addIssue({
      code: 'custom',
      message: 'a template says what it does, not only what it never does',
      path: ['template', 'outcomes'],
    });
  }
}

/** A template's manifest: the pack manifest, its category, and the
 * template block. Every starter is one. */
export const automationTemplateManifestSchema = automationPackManifestSchema
  .extend({ category: automationCategorySchema, template: templateBlockSchema })
  .superRefine((manifest, ctx) => checkTemplate(manifest, ctx));

export type AutomationTemplateManifest = z.infer<
  typeof automationTemplateManifestSchema
>;

/**
 * A SHIPPED pack's manifest (`configs/platform/custom/automations/`): the
 * pack manifest with an optional template block — a pack that carries one
 * is in the template catalog and must name its category. Packages uploaded
 * by an organization and native releases keep the plain pack manifest.
 */
export const shippedPackManifestSchema = automationPackManifestSchema
  .extend({ template: templateBlockSchema.optional() })
  .superRefine((manifest, ctx) => {
    const { template } = manifest;
    if (template === undefined) return;
    if (manifest.category === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'a pack with a template block names its category',
        path: ['category'],
      });
    }
    checkTemplate({ ...manifest, template }, ctx);
  });

export type ShippedPackManifest = z.infer<typeof shippedPackManifestSchema>;

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

/** The answers to a template's questions, by question id: text for
 * `project`, `member`, `text`, `choice` and `credential`, a number for
 * `number`, a boolean for `toggle`, a list of texts for `list` and the
 * schedule for `schedule`. Whether an answer fits its question is the
 * template's to say. */
export const templateAnswersSchema = z
  .record(
    z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/),
    z.union([
      z.string().max(MAX_TEMPLATE_TEXT_ANSWER),
      z.number().finite(),
      z.boolean(),
      z
        .array(z.string().max(MAX_TEMPLATE_LIST_ITEM))
        .max(MAX_TEMPLATE_LIST_ITEMS),
      scheduleAnswerSchema,
    ]),
  )
  .refine((answers) => Object.keys(answers).length <= MAX_TEMPLATE_FIELDS, {
    message: `at most ${MAX_TEMPLATE_FIELDS} answers`,
  });

export type TemplateAnswers = z.infer<typeof templateAnswersSchema>;
