/**
 * THE reader for the template catalog — every automation Tale ships, as a
 * template a person previews and uses — and the one way a template becomes
 * an automation.
 *
 * The catalog has two roots and one shape. The starters live in the system
 * catalog (`configs/platform/system/automation-templates/<slug>/`), the
 * packs in the builtin catalog (`configs/platform/custom/automations/<path>/`);
 * both are pack-format directories (`automation.yml` + `workflow.yml`, read
 * by the pack reader) whose manifest carries a `template` block: what the
 * preview says and the questions a person answers
 * (`@tale/shared/schemas/automation-template`). A pack without a template
 * block, or a hidden one, is not in the catalog. A template's slug is its
 * directory below its root, so `task-digest` and `gmail/sync-emails` sit
 * side by side; no slug is in both roots.
 *
 * Using a template writes each answer where its question says — a step or
 * the template's trigger, and a pointer inside it — into a copy of the
 * shipped document, never into YAML text, so the result is the validated
 * document with values swapped in.
 *
 * Reading the catalog needs the filesystem, so consumers are node-side.
 */

import path from 'node:path';

import type { AutomationTrigger } from '@tale/shared/schemas/automation-pack';
import {
  automationTemplateManifestSchema,
  DEFAULT_LIST_ITEM_LENGTH,
  DEFAULT_LIST_ITEMS,
  MAX_TEMPLATE_TEXT_ANSWER,
  scheduleAnswerSchema,
  type AutomationTemplateManifest,
  type TemplateAnswers,
  type TemplateField,
  type TemplateFieldWrite,
} from '@tale/shared/schemas/automation-template';
import {
  timeZoneSchema,
  triggerWriteSchema,
} from '@tale/shared/schemas/automation-trigger';

import {
  ptr,
  replaceAtPointer,
  resolvePointer,
} from '../engine/core/syntax/pointer';
import type { Automation } from '../engine/core/types';
import {
  resolveSystemConfigRoot,
  SYSTEM_CONFIG_ROOT_REMEDY,
} from '../shared/config/system-root';
import {
  loadAutomationPacks,
  readPackDirectories,
  type AutomationPack,
  type PackDirectory,
} from './packs';

/** Where a template ships: a starter of the system catalog, or a pack of
 * the builtin catalog. */
export type TemplateSource = 'starter' | 'pack';

/** One template of the catalog. */
export interface AutomationTemplate extends PackDirectory<AutomationTemplateManifest> {
  readonly source: TemplateSource;
}

/** The starters' directory below the system catalog. */
const TEMPLATES_DIR = 'automation-templates';

export interface LoadTemplatesOptions {
  /** Absolute path of the `system/` config directory (the one containing
   * `automation-templates/`). Defaults to the shared system-root resolver. */
  readonly root?: string;
  /** Absolute path of the builtin `custom/` directory (the one containing
   * `automations/`). Defaults to the repo walk-up; `null` reads no packs —
   * a deployment whose builtin catalog cannot be found. */
  readonly packsRoot?: string | null;
  /** Refuse a slug both roots ship — the shipped tree's guard. A running
   * deployment, whose builtin directory an operator may have baked, keeps
   * the starter, says so and leaves the pack out instead: one duplicate
   * must not take the whole catalog down. */
  readonly strict?: boolean;
}

function resolveTemplatesDir(options: LoadTemplatesOptions = {}): string {
  const root = resolveSystemConfigRoot({
    ...(options.root !== undefined && { root: options.root }),
  });
  if (root === null) {
    throw new Error(
      `[automations] no system config tree found: ${SYSTEM_CONFIG_ROOT_REMEDY}`,
    );
  }
  return path.join(root, TEMPLATES_DIR);
}

/** The pack as a template, or null for a pack the catalog leaves out: one
 * without a template block, or a hidden one. */
function packTemplate(pack: AutomationPack): AutomationTemplate | null {
  const { manifest } = pack;
  if (manifest.hidden === true) return null;
  if (manifest.template === undefined || manifest.category === undefined) {
    return null;
  }
  return {
    ...pack,
    manifest: {
      ...manifest,
      template: manifest.template,
      category: manifest.category,
    },
    source: 'pack',
  };
}

/** The shipped packs that are not in the catalog although nothing hides
 * them: they carry no template block. The catalog suite holds this empty. */
export function packsWithoutTemplate(
  options: Pick<LoadTemplatesOptions, 'packsRoot'> = {},
): string[] {
  if (options.packsRoot === null) return [];
  return loadAutomationPacks(
    options.packsRoot === undefined ? {} : { root: options.packsRoot },
  )
    .filter(
      (pack) =>
        pack.manifest.hidden !== true && pack.manifest.template === undefined,
    )
    .map((pack) => pack.slug);
}

/**
 * Every template of the catalog, sorted by slug: the starters and the packs
 * that carry a template block. A slug both roots hold is a packaging defect:
 * `strict` throws on it, otherwise the starter is kept and the pack left out
 * with a warning, so the catalog never answers two templates for one slug.
 */
export function loadAutomationTemplates(
  options: LoadTemplatesOptions = {},
): AutomationTemplate[] {
  const starters: AutomationTemplate[] = readPackDirectories(
    resolveTemplatesDir(options),
    automationTemplateManifestSchema,
    { kind: 'starter', maxDepth: 1 },
  ).map((starter) => Object.assign(starter, { source: 'starter' as const }));
  const packs =
    options.packsRoot === null
      ? []
      : loadAutomationPacks(
          options.packsRoot === undefined ? {} : { root: options.packsRoot },
        )
          .map(packTemplate)
          .filter((template) => template !== null);
  const bySlug = new Map<string, AutomationTemplate>();
  for (const template of [...starters, ...packs]) {
    if (bySlug.has(template.slug)) {
      const twice = `[automations] the template "${template.slug}" ships twice: as a starter and as a pack`;
      if (options.strict === true) throw new Error(twice);
      console.warn(`${twice}; the pack is left out of the catalog`);
      continue;
    }
    bySlug.set(template.slug, template);
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** One template by its slug, or null. */
export function findAutomationTemplate(
  slug: string,
  options: LoadTemplatesOptions = {},
): AutomationTemplate | null {
  return (
    loadAutomationTemplates(options).find(
      (template) => template.slug === slug,
    ) ?? null
  );
}

// ------------------------------------------------------------ the answers

/** Why an answer cannot be used. `unknown` is the organization's to say (a
 * project, member or credential it does not have); the rest the answers
 * show on their own. */
export type TemplateAnswerIssueCode =
  | 'required'
  | 'too_long'
  | 'invalid'
  | 'unknown'
  | 'unexpected';

export interface TemplateAnswerIssue {
  /** The question's id. */
  field: string;
  code: TemplateAnswerIssueCode;
  message: string;
}

/** What an answer writes: text, a number, on or off, or a list of texts. */
type WriteValue = string | number | boolean | string[];

/** A question's answer once read: the value to write, nothing to write, or
 * why it cannot be used. */
type ReadAnswer =
  | { value: WriteValue }
  | { value: null }
  | { issue: Omit<TemplateAnswerIssue, 'field'> };

const NOTHING: ReadAnswer = { value: null };

function issue(code: TemplateAnswerIssueCode, message: string): ReadAnswer {
  return { issue: { code, message } };
}

/** A text question's default in the creator's language, when the template
 * words one for it. */
function textDefault(
  field: Extract<TemplateField, { kind: 'text' }>,
  locale: string | undefined,
): string {
  const base = locale?.split('-')[0];
  return (
    (locale === undefined ? undefined : field.i18n?.[locale]?.default) ??
    (base === undefined ? undefined : field.i18n?.[base]?.default) ??
    field.default ??
    ''
  );
}

/** The answer as a list of texts, or null when it is not one. */
function textList(answer: unknown): string[] | null {
  if (!Array.isArray(answer)) return null;
  const texts: string[] = [];
  for (const item of answer) {
    if (typeof item !== 'string') return null;
    texts.push(item);
  }
  return texts;
}

/** A list answer as it will be written: trimmed items, blank and repeated
 * ones dropped, in the order given. */
function listItems(answer: readonly string[]): string[] {
  const items: string[] = [];
  for (const raw of answer) {
    const item = raw.trim();
    if (item !== '' && !items.includes(item)) items.push(item);
  }
  return items;
}

/**
 * Read one question's answer: what it writes, or why it cannot be used.
 * A blank text or choice takes its default (a text's in the creator's
 * language), a blank number its default, an untouched toggle its default
 * (off) and an absent list its default (none). Whether a project, member or
 * credential exists is the organization's to check.
 */
function readAnswer(
  field: Exclude<TemplateField, { kind: 'schedule' }>,
  answer: unknown,
  locale: string | undefined,
): ReadAnswer {
  switch (field.kind) {
    case 'number': {
      if (answer === undefined || answer === '') {
        if (field.default !== undefined) return { value: field.default };
        return field.required === false
          ? NOTHING
          : issue('required', `"${field.label}" needs an answer.`);
      }
      if (
        typeof answer !== 'number' ||
        !Number.isInteger(answer) ||
        answer < field.min ||
        answer > field.max
      ) {
        return issue(
          'invalid',
          `"${field.label}" takes a whole number from ${field.min} to ${field.max}.`,
        );
      }
      return { value: answer };
    }
    case 'toggle': {
      if (answer === undefined) return { value: field.default ?? false };
      return typeof answer === 'boolean'
        ? { value: answer }
        : issue('invalid', `"${field.label}" is on or off.`);
    }
    case 'list': {
      const given = textList(answer);
      if (answer !== undefined && given === null) {
        return issue('invalid', `"${field.label}" takes a list of texts.`);
      }
      const items = listItems(given ?? field.default ?? []);
      const maxItems = field.maxItems ?? DEFAULT_LIST_ITEMS;
      const itemMax = field.itemMaxLength ?? DEFAULT_LIST_ITEM_LENGTH;
      if (items.length > maxItems) {
        return issue(
          'too_long',
          `"${field.label}" takes at most ${maxItems} items.`,
        );
      }
      if (items.some((item) => item.length > itemMax)) {
        return issue(
          'too_long',
          `"${field.label}" takes items of at most ${itemMax} characters.`,
        );
      }
      if (items.length === 0 && field.required === true) {
        return issue('required', `"${field.label}" needs an answer.`);
      }
      return { value: items };
    }
    default:
      break;
  }
  if (answer !== undefined && typeof answer !== 'string') {
    return issue('invalid', 'The answer must be text.');
  }
  const given = typeof answer === 'string' ? answer.trim() : '';
  const value =
    given !== ''
      ? given
      : field.kind === 'text'
        ? textDefault(field, locale)
        : field.kind === 'choice'
          ? (field.default ?? '')
          : '';
  if (value === '') {
    const optional =
      (field.kind === 'text' || field.kind === 'credential') &&
      field.required === false;
    return optional
      ? NOTHING
      : issue('required', `"${field.label}" needs an answer.`);
  }
  if (
    field.kind === 'choice' &&
    !field.options.some((option) => option.value === value)
  ) {
    return issue(
      'invalid',
      `"${field.label}" takes one of the values it offers.`,
    );
  }
  const max =
    field.kind === 'text'
      ? (field.maxLength ?? MAX_TEMPLATE_TEXT_ANSWER)
      : MAX_TEMPLATE_TEXT_ANSWER;
  if (value.length > max) {
    return issue(
      'too_long',
      `"${field.label}" takes at most ${max} characters.`,
    );
  }
  if (
    field.kind === 'text' &&
    field.pattern !== undefined &&
    !new RegExp(`^(?:${field.pattern})$`, 'u').test(value)
  ) {
    return issue(
      'invalid',
      `"${field.label}" does not have the form it takes.`,
    );
  }
  return { value };
}

/**
 * The template's trigger as the store will be asked to save it: the
 * schedule answer applied, or — for a schedule nobody answered — the
 * creator's time zone in place of the shipped one, which only says where
 * the author's clock stood. Off unless the template turns it on; the
 * create that starts the automation turns it on. Undefined when the
 * template declares none. Answers written into the trigger are not here
 * yet ({@link instantiateTemplate} writes them).
 */
function instanceTrigger(
  manifest: AutomationTemplateManifest,
  answers: TemplateAnswers,
  timezone: string | undefined,
): AutomationTrigger | undefined {
  const declared = manifest.triggers?.[0];
  if (declared === undefined) return undefined;
  const field = manifest.template.fields.find(
    (candidate) => candidate.kind === 'schedule',
  );
  const answer = field === undefined ? undefined : answers[field.id];
  const parsed = scheduleAnswerSchema.safeParse(answer);
  if (declared.kind !== 'schedule') {
    return structuredClone({ ...declared, enabled: declared.enabled ?? false });
  }
  if (answer !== undefined && parsed.success) {
    // The answer says the whole schedule: the declared rule, cron and
    // missed-runs choice give way to it.
    const {
      cron: _cron,
      repeat: _repeat,
      catchUp: _catchUp,
      ...rest
    } = declared;
    const { repeat, cron, timezone: zone, catchUp } = parsed.data;
    return structuredClone({
      ...rest,
      ...(repeat !== undefined && { repeat }),
      ...(cron !== undefined && cron.trim() !== '' && { cron }),
      timezone: zone,
      ...(catchUp !== undefined && { catchUp }),
      enabled: declared.enabled ?? false,
    });
  }
  const zone =
    timezone !== undefined && timeZoneSchema.safeParse(timezone).success
      ? timezone
      : declared.timezone;
  return structuredClone({
    ...declared,
    ...(zone !== undefined && { timezone: zone }),
    enabled: declared.enabled ?? false,
  });
}

/**
 * What is wrong with the answers on their own: a required question left
 * blank, a text over its length or off its form, a number out of its
 * bounds, a list too long, a schedule the trigger contract refuses, or an
 * answer to a question the template does not ask. Whether a project,
 * member or credential exists is the organization's to check.
 */
export function templateAnswerIssues(
  template: AutomationTemplate,
  answers: TemplateAnswers,
  locale?: string,
): TemplateAnswerIssue[] {
  const fields = template.manifest.template.fields;
  const issues: TemplateAnswerIssue[] = [];
  const asked = new Set(fields.map((field) => field.id));
  for (const key of Object.keys(answers)) {
    if (!asked.has(key)) {
      issues.push({
        field: key,
        code: 'unexpected',
        message: `The template asks no question "${key}".`,
      });
    }
  }
  for (const field of fields) {
    const answer = answers[field.id];
    if (field.kind === 'schedule') {
      if (answer === undefined) continue;
      if (!scheduleAnswerSchema.safeParse(answer).success) {
        issues.push({
          field: field.id,
          code: 'invalid',
          message:
            'The schedule is not a repeat rule or a cron expression with its time zone.',
        });
        continue;
      }
      const trigger = triggerWriteSchema.safeParse(
        instanceTrigger(template.manifest, answers, undefined),
      );
      if (!trigger.success) {
        issues.push({
          field: field.id,
          code: 'invalid',
          message:
            trigger.error.issues[0]?.message ?? 'The schedule cannot run.',
        });
      }
      continue;
    }
    const read = readAnswer(field, answer, locale);
    if ('issue' in read) issues.push({ field: field.id, ...read.issue });
  }
  return issues;
}

// --------------------------------------------------------- the automation

/** The automation a template makes from a set of answers. */
export interface TemplateInstance {
  /** The shipped document under its new name, the answers written in. */
  document: Automation;
  /** The template's trigger, off, with the schedule answer (or the
   * creator's zone) and the answers it takes applied. */
  trigger?: AutomationTrigger;
  /** The project the automation is installed in. */
  projectId?: string;
}

/** Where one write of a question lands. */
export type TemplateWriteTarget =
  | { target: 'node'; pointer: string | null }
  | { target: 'trigger'; pointer: string };

/** Where a question's answer goes: a pointer into the whole document for
 * a step (null for a step the document does not have), or into the
 * template's trigger. */
export function templateWriteTargets(
  document: Automation,
  field: TemplateField,
): TemplateWriteTarget[] {
  if (!('writes' in field) || field.writes === undefined) return [];
  return field.writes.map((write: TemplateFieldWrite) => {
    if ('trigger' in write) {
      return { target: 'trigger', pointer: write.pointer };
    }
    const at = document.nodes.findIndex((node) => node.id === write.node);
    return {
      target: 'node',
      pointer: at < 0 ? null : `${ptr('nodes', at)}${write.pointer}`,
    };
  });
}

/** The value as the placeholder it replaces takes it: a list placeholder
 * a list (a text as a list of one), a text placeholder a list's items
 * joined with ", ". */
function shapedFor(placeholder: unknown, value: WriteValue): unknown {
  if (Array.isArray(placeholder)) {
    return Array.isArray(value) ? value : [value];
  }
  if (Array.isArray(value) && typeof placeholder === 'string') {
    return value.join(', ');
  }
  return value;
}

/** Write `value` where `pointer` names a value inside `holder`, shaped
 * like it; false when nothing is there. */
function writeAt(holder: unknown, pointer: string, value: WriteValue): boolean {
  const placeholder = resolvePointer(holder, pointer);
  return (
    placeholder.found &&
    replaceAtPointer(holder, pointer, shapedFor(placeholder.value, value))
  );
}

/**
 * Build the automation `template` makes for `answers`, named `name`. The
 * answers must already be free of issues ({@link templateAnswerIssues}); a
 * place the template names that its document or trigger does not hold is a
 * packaging defect the catalog suite catches, and throws here. `timezone`
 * is the creator's: a schedule the answers leave alone runs in it.
 */
export function instantiateTemplate(
  template: AutomationTemplate,
  args: {
    name: string;
    answers: TemplateAnswers;
    locale?: string;
    timezone?: string;
  },
): TemplateInstance {
  const document = structuredClone(template.automation);
  document.name = args.name;
  const trigger = instanceTrigger(
    template.manifest,
    args.answers,
    args.timezone,
  );
  let projectId: string | undefined;
  for (const field of template.manifest.template.fields) {
    if (field.kind === 'schedule') continue;
    const read = readAnswer(field, args.answers[field.id], args.locale);
    if (!('value' in read) || read.value === null) continue;
    const { value } = read;
    if (field.kind === 'project' && typeof value === 'string') {
      projectId = value;
    }
    for (const write of templateWriteTargets(template.automation, field)) {
      const written =
        write.pointer !== null &&
        (write.target === 'node'
          ? writeAt(document, write.pointer, value)
          : trigger !== undefined && writeAt(trigger, write.pointer, value));
      if (!written) {
        throw new Error(
          `[automations] template "${template.slug}" writes "${field.id}" where its ${write.target === 'node' ? 'document' : 'trigger'} holds nothing`,
        );
      }
    }
  }
  return {
    document,
    ...(trigger !== undefined && { trigger }),
    ...(projectId !== undefined && { projectId }),
  };
}
