/**
 * The template catalog's reading of a template (`automation-templates`):
 * its words in the reader's language, the order the catalog shows its
 * categories in, what its questions start as and which are still
 * unanswered, and the answers as the create sends them. A template carries
 * every language it is worded in; English stands in for the rest.
 */

import type { ReturnsOf } from '@/app/lib/backend/contract';

export type TemplateCard =
  ReturnsOf<'automations/queries:listAutomationTemplates'>['templates'][number];

export type TemplateDetail =
  ReturnsOf<'automations/queries:getAutomationTemplate'>;

export type TemplateField = TemplateCard['fields'][number];

export type TemplateCategory = TemplateCard['category'];

export type TemplateStep = TemplateCard['steps'][number];

export type TemplateOutcome = TemplateCard['outcomes'][number];

/** The order the catalog's category tabs and its cards follow: where a
 * team starts (its inbox, its issues), then what it adds. */
export const TEMPLATE_CATEGORY_ORDER: readonly TemplateCategory[] = [
  'inbox',
  'issues',
  'code-review',
  'tasks',
  'notifications',
  'webhooks',
];

/** The category `value` names, if it names one — a link's tab, read from
 * its address. */
export function templateCategoryOf(
  value: unknown,
): TemplateCategory | undefined {
  return TEMPLATE_CATEGORY_ORDER.find((category) => category === value);
}

/** The translate function of the session's language, bound to the
 *  `automations` namespace. */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/** A category's name, as its tab and its chip say it. */
export function categoryLabel(
  t: Translate,
  category: TemplateCategory,
): string {
  switch (category) {
    case 'inbox':
      return t('templates.categories.inbox');
    case 'issues':
      return t('templates.categories.issues');
    case 'code-review':
      return t('templates.categories.codeReview');
    case 'tasks':
      return t('templates.categories.tasks');
    case 'notifications':
      return t('templates.categories.notifications');
    case 'webhooks':
      return t('templates.categories.webhooks');
    default: {
      const exhaustive: never = category;
      return String(exhaustive);
    }
  }
}

/** What an outcome does, said before its line to a screen reader (its
 * icon says it to the eye); a `never` line says it itself. */
export function outcomeKindLabel(
  t: Translate,
  kind: TemplateOutcome['kind'],
): string | null {
  switch (kind) {
    case 'creates':
      return t('templates.outcomeKinds.creates');
    case 'changes':
      return t('templates.outcomeKinds.changes');
    case 'sends':
      return t('templates.outcomeKinds.sends');
    case 'never':
      return null;
    default: {
      const exhaustive: never = kind;
      return String(exhaustive);
    }
  }
}

/** What a question's answer holds while the form is open: text for the
 * questions that take text (a list as its lines), a number, or on/off. A
 * schedule question is the form's own draft, not here. */
export type FormAnswer = string | number | boolean;

/** `de` for `de-CH`. */
function baseLocale(locale: string): string {
  return locale.split('-')[0] ?? locale;
}

/** The template's name, one line and paragraph in the reader's language. */
export function templateWords(
  card: TemplateCard,
  locale: string,
): { name: string; description?: string; details: string } {
  const own = { ...card.i18n[baseLocale(locale)], ...card.i18n[locale] };
  const description = own.description ?? card.description;
  return {
    name: own.name ?? card.name,
    ...(description !== undefined && { description }),
    details: own.details ?? card.details,
  };
}

/** A step of "How it works" in the reader's language. */
export function stepWords(
  step: TemplateStep,
  locale: string,
): { title: string; detail?: string } {
  const own = {
    ...step.i18n?.[baseLocale(locale)],
    ...step.i18n?.[locale],
  };
  const detail = own.detail ?? step.detail;
  return {
    title: own.title ?? step.title,
    ...(detail !== undefined && { detail }),
  };
}

/** A line of "What it changes" in the reader's language. */
export function outcomeText(outcome: TemplateOutcome, locale: string): string {
  return (
    outcome.i18n?.[locale]?.text ??
    outcome.i18n?.[baseLocale(locale)]?.text ??
    outcome.text
  );
}

/** A question's label, description and example in the reader's language. */
export function fieldWords(
  field: TemplateField,
  locale: string,
): { label: string; description?: string; placeholder?: string } {
  const own = { ...field.i18n?.[baseLocale(locale)], ...field.i18n?.[locale] };
  const description = own.description ?? field.description;
  const placeholder =
    own.placeholder ?? ('placeholder' in field ? field.placeholder : undefined);
  return {
    label: own.label ?? field.label,
    ...(description !== undefined && { description }),
    ...(placeholder !== undefined && { placeholder }),
  };
}

/** A choice's option label in the reader's language. */
export function optionLabel(
  option: Extract<TemplateField, { kind: 'choice' }>['options'][number],
  locale: string,
): string {
  return (
    option.i18n?.[locale]?.label ??
    option.i18n?.[baseLocale(locale)]?.label ??
    option.label
  );
}

/** The connectors a template needs that the organization has not
 * connected yet. */
export function missingConnectors(card: TemplateCard): string[] {
  return card.connectors
    .filter((connector) => !connector.connected)
    .map((connector) => connector.slug);
}

/** The catalog's order: by category, then by name as the reader reads it. */
export function sortTemplates(
  cards: readonly TemplateCard[],
  locale: string,
): TemplateCard[] {
  const rank = (card: TemplateCard) => {
    const at = TEMPLATE_CATEGORY_ORDER.indexOf(card.category);
    return at < 0 ? TEMPLATE_CATEGORY_ORDER.length : at;
  };
  return [...cards].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      templateWords(left, locale).name.localeCompare(
        templateWords(right, locale).name,
        locale,
      ),
  );
}

/** What a template is searched by: its words in the reader's language and
 * in English, and its product chips. */
export function templateHaystack(card: TemplateCard, locale: string): string[] {
  const own = templateWords(card, locale);
  return [
    own.name,
    own.description ?? '',
    card.name,
    card.description ?? '',
    ...card.labels,
  ];
}

/** Whether a question must be answered before the create. A toggle and a
 * number always hold a value; a schedule question is the form's own draft
 * and keeps the template's schedule untouched. */
function isRequiredField(field: TemplateField): boolean {
  switch (field.kind) {
    case 'text':
    case 'credential':
      return field.required !== false;
    case 'list':
      return field.required === true;
    case 'schedule':
    case 'toggle':
    case 'number':
      return false;
    default:
      return true;
  }
}

/**
 * What each question starts as: a text's default in the reader's language,
 * a choice's default, a number's default (or its minimum), a toggle's
 * default, a list's default as its lines, the project the catalog was
 * opened in, and — for a required credential question — the credential when
 * the organization has exactly one in service for it. Schedule questions are
 * not here — the form holds them as a schedule draft.
 */
export function initialAnswers(
  card: TemplateCard,
  options: {
    locale: string;
    projectId?: string;
    credentials?: Readonly<Record<string, readonly { name: string }[]>>;
  },
): Record<string, FormAnswer> {
  const answers: Record<string, FormAnswer> = {};
  for (const field of card.fields) {
    switch (field.kind) {
      case 'text':
        answers[field.id] =
          field.i18n?.[options.locale]?.default ??
          field.i18n?.[baseLocale(options.locale)]?.default ??
          field.default ??
          '';
        break;
      case 'choice':
        answers[field.id] = field.default ?? '';
        break;
      case 'project':
        answers[field.id] = options.projectId ?? '';
        break;
      case 'number':
        answers[field.id] = field.default ?? field.min;
        break;
      case 'toggle':
        answers[field.id] = field.default ?? false;
        break;
      case 'list':
        answers[field.id] = (field.default ?? []).join('\n');
        break;
      case 'credential': {
        // A required question takes the one credential in service; an
        // optional one starts on its empty choice, which means something of
        // its own (the default connection, every mailbox).
        const inService = options.credentials?.[field.connector] ?? [];
        answers[field.id] =
          field.required !== false && inService.length === 1
            ? (inService[0]?.name ?? '')
            : '';
        break;
      }
      case 'member':
        answers[field.id] = '';
        break;
      case 'schedule':
        break;
      default: {
        const exhaustive: never = field;
        throw new Error(`unhandled question ${String(exhaustive)}`);
      }
    }
  }
  return answers;
}

/** The ids of the questions that must be answered and are still blank. */
export function unansweredFields(
  fields: readonly TemplateField[],
  answers: Readonly<Record<string, FormAnswer>>,
): string[] {
  return fields
    .filter((field) => {
      if (!isRequiredField(field)) return false;
      const answer = answers[field.id];
      if (field.kind === 'list') {
        return typeof answer !== 'string' || listLines(answer).length === 0;
      }
      return typeof answer !== 'string' || answer.trim() === '';
    })
    .map((field) => field.id);
}

/** A list question's text as its items: one a line, trimmed, blank lines
 * dropped. */
export function listLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** The answers as the create sends them: a list as its items, a blank
 * optional answer left out, the rest as they are. */
export function wireAnswers(
  fields: readonly TemplateField[],
  answers: Readonly<Record<string, FormAnswer>>,
): Record<string, string | number | boolean | string[]> {
  const wire: Record<string, string | number | boolean | string[]> = {};
  for (const field of fields) {
    const answer = answers[field.id];
    if (answer === undefined || field.kind === 'schedule') continue;
    if (field.kind === 'list') {
      wire[field.id] = typeof answer === 'string' ? listLines(answer) : [];
      continue;
    }
    if (typeof answer === 'string' && answer.trim() === '') {
      if (isRequiredField(field)) wire[field.id] = answer;
      continue;
    }
    wire[field.id] = answer;
  }
  return wire;
}
