/**
 * THE reader for the shipped automation starters —
 * `configs/platform/system/automation-templates/<slug>/` — and the one way a
 * starter becomes an automation.
 *
 * A starter is a pack-format directory (`automation.yml` + `workflow.yml`,
 * read by the pack reader) whose manifest adds a `template` block: the
 * questions a person answers when creating from it
 * (`@tale/shared/schemas/automation-template`). Instantiating writes each
 * answer where its question says — a step's id and a pointer inside the
 * step — into a copy of the shipped document, never into YAML text, so the
 * result is the validated document with values swapped in.
 *
 * Reading the catalog needs the filesystem, so consumers are node-side.
 */

import path from 'node:path';

import type { AutomationTrigger } from '@tale/shared/schemas/automation-pack';
import {
  automationTemplateManifestSchema,
  MAX_TEMPLATE_TEXT_ANSWER,
  scheduleAnswerSchema,
  type AutomationTemplateManifest,
  type TemplateAnswers,
  type TemplateField,
} from '@tale/shared/schemas/automation-template';
import { triggerWriteSchema } from '@tale/shared/schemas/automation-trigger';

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
import { readPackDirectories, type PackDirectory } from './packs';

export type AutomationTemplate = PackDirectory<AutomationTemplateManifest>;

/** The starters' directory below the system catalog. */
const TEMPLATES_DIR = 'automation-templates';

export interface LoadTemplatesOptions {
  /** Absolute path of the `system/` config directory (the one containing
   * `automation-templates/`). Defaults to the shared system-root resolver. */
  readonly root?: string;
}

function resolveTemplatesDir(options: LoadTemplatesOptions = {}): string {
  const root = resolveSystemConfigRoot({ root: options.root });
  if (root === null) {
    throw new Error(
      `[automations] no system config tree found: ${SYSTEM_CONFIG_ROOT_REMEDY}`,
    );
  }
  return path.join(root, TEMPLATES_DIR);
}

/** Every shipped starter, sorted by slug — one directory each, never
 * nested. */
export function loadAutomationTemplates(
  options: LoadTemplatesOptions = {},
): AutomationTemplate[] {
  return readPackDirectories(
    resolveTemplatesDir(options),
    automationTemplateManifestSchema,
    { kind: 'starter', maxDepth: 1 },
  );
}

/** One starter by its slug, or null. */
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

/** Whether a question must be answered. A text question may be optional;
 * a schedule question keeps the starter's own schedule when unanswered. */
function isRequired(field: TemplateField): boolean {
  if (field.kind === 'text') return field.required !== false;
  return field.kind !== 'schedule';
}

/** An answer as it will be written: trimmed, or — for a text or a choice
 * left blank — the question's default, in the creator's language when the
 * starter words one for it. Empty when there is nothing to write. */
function answerValue(
  field: Exclude<TemplateField, { kind: 'schedule' }>,
  answer: unknown,
  locale: string | undefined,
): string {
  const given = typeof answer === 'string' ? answer.trim() : '';
  if (given !== '') return given;
  if (field.kind === 'text') {
    return (
      (locale === undefined ? undefined : field.i18n?.[locale]?.default) ??
      field.default ??
      ''
    );
  }
  return field.kind === 'choice' ? (field.default ?? '') : '';
}

/** The starter's trigger with the schedule answer applied, as the store
 * will be asked to save it — off unless the starter turns it on, since
 * nothing is deployed yet. Undefined when the starter declares none. */
function instanceTrigger(
  manifest: AutomationTemplateManifest,
  answers: TemplateAnswers,
): AutomationTrigger | undefined {
  const declared = manifest.triggers?.[0];
  if (declared === undefined) return undefined;
  const field = manifest.template.fields.find(
    (candidate) => candidate.kind === 'schedule',
  );
  const answer = field === undefined ? undefined : answers[field.id];
  const parsed = scheduleAnswerSchema.safeParse(answer);
  const scheduled =
    declared.kind === 'schedule' && answer !== undefined && parsed.success
      ? (() => {
          const { cron: _cron, ...rest } = declared;
          return {
            ...rest,
            repeat: parsed.data.repeat,
            timezone: parsed.data.timezone,
          };
        })()
      : declared;
  return { ...scheduled, enabled: declared.enabled ?? false };
}

/**
 * What is wrong with the answers on their own: a required question left
 * blank, a text over its length, a schedule the trigger contract refuses,
 * or an answer to a question the starter does not ask. Whether a project,
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
        message: `The starter asks no question "${key}".`,
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
          message: 'The schedule is not a repeat rule with its time zone.',
        });
        continue;
      }
      const trigger = triggerWriteSchema.safeParse(
        instanceTrigger(template.manifest, answers),
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
    if (answer !== undefined && typeof answer !== 'string') {
      issues.push({
        field: field.id,
        code: 'invalid',
        message: 'The answer must be text.',
      });
      continue;
    }
    const value = answerValue(field, answer, locale);
    if (value === '') {
      if (isRequired(field)) {
        issues.push({
          field: field.id,
          code: 'required',
          message: `"${field.label}" needs an answer.`,
        });
      }
      continue;
    }
    if (
      field.kind === 'choice' &&
      !field.options.some((option) => option.value === value)
    ) {
      issues.push({
        field: field.id,
        code: 'invalid',
        message: `"${field.label}" takes one of the values it offers.`,
      });
      continue;
    }
    const max =
      field.kind === 'text'
        ? (field.maxLength ?? MAX_TEMPLATE_TEXT_ANSWER)
        : MAX_TEMPLATE_TEXT_ANSWER;
    if (value.length > max) {
      issues.push({
        field: field.id,
        code: 'too_long',
        message: `"${field.label}" takes at most ${max} characters.`,
      });
    }
  }
  return issues;
}

// --------------------------------------------------------- the automation

/** The automation a starter makes from a set of answers. */
export interface TemplateInstance {
  /** The shipped document under its new name, the answers written in. */
  document: Automation;
  /** The starter's trigger, off, the schedule answer applied. */
  trigger?: AutomationTrigger;
  /** The project the automation is installed in. */
  projectId?: string;
}

/** Where a question's answer goes, as pointers into the whole document;
 * null for a step the document does not have. */
export function templateWritePointers(
  document: Automation,
  field: TemplateField,
): (string | null)[] {
  if (!('writes' in field) || field.writes === undefined) return [];
  return field.writes.map((write) => {
    const at = document.nodes.findIndex((node) => node.id === write.node);
    return at < 0 ? null : `${ptr('nodes', at)}${write.pointer}`;
  });
}

/**
 * Build the automation `template` makes for `answers`, named `name`. The
 * answers must already be free of issues ({@link templateAnswerIssues}); a
 * place the starter names that its document does not hold is a packaging
 * defect the starter suite catches, and throws here.
 */
export function instantiateTemplate(
  template: AutomationTemplate,
  args: { name: string; answers: TemplateAnswers; locale?: string },
): TemplateInstance {
  const document = structuredClone(template.automation);
  document.name = args.name;
  let projectId: string | undefined;
  for (const field of template.manifest.template.fields) {
    if (field.kind === 'schedule') continue;
    const value = answerValue(field, args.answers[field.id], args.locale);
    if (field.kind === 'project' && value !== '') projectId = value;
    if (value === '') continue;
    for (const pointer of templateWritePointers(template.automation, field)) {
      // The placeholder's shape decides the answer's: a list takes a list
      // of one.
      const placeholder =
        pointer === null ? null : resolvePointer(document, pointer);
      const written =
        pointer !== null &&
        placeholder?.found === true &&
        replaceAtPointer(
          document,
          pointer,
          Array.isArray(placeholder.value) ? [value] : value,
        );
      if (!written) {
        throw new Error(
          `[automations] starter "${template.slug}" writes "${field.id}" where its document holds nothing`,
        );
      }
    }
  }
  const trigger = instanceTrigger(template.manifest, args.answers);
  return {
    document,
    ...(trigger !== undefined && { trigger }),
    ...(projectId !== undefined && { projectId }),
  };
}
