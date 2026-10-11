/**
 * The starter gallery's reading of a starter (`automation-templates`):
 * its words in the reader's language, what its questions start as, and
 * which are still unanswered. A starter carries every language it is
 * worded in; English stands in for the rest.
 */

import type { ReturnsOf } from '@/app/lib/backend/contract';

export type StarterCard =
  ReturnsOf<'automations/queries:listAutomationTemplates'>['templates'][number];

export type StarterField = StarterCard['fields'][number];

/** `de` for `de-CH`. */
function baseLocale(locale: string): string {
  return locale.split('-')[0] ?? locale;
}

/** The starter's name, one line and paragraph in the reader's language. */
export function starterWords(
  card: StarterCard,
  locale: string,
): { name: string; description?: string; details: string } {
  const own = card.i18n[baseLocale(locale)];
  const description = own?.description ?? card.description;
  return {
    name: own?.name ?? card.name,
    ...(description !== undefined && { description }),
    details: own?.details ?? card.details,
  };
}

/** A question's label and description in the reader's language. */
export function fieldWords(
  field: StarterField,
  locale: string,
): { label: string; description?: string } {
  const own = field.i18n?.[baseLocale(locale)];
  const description = own?.description ?? field.description;
  return {
    label: own?.label ?? field.label,
    ...(description !== undefined && { description }),
  };
}

/** A choice's option label in the reader's language. */
export function optionLabel(
  option: Extract<StarterField, { kind: 'choice' }>['options'][number],
  locale: string,
): string {
  return option.i18n?.[baseLocale(locale)]?.label ?? option.label;
}

/** Whether a question must be answered before the create. A schedule
 * question is the form's own draft, and keeps the starter's schedule
 * untouched. */
function isRequiredField(field: StarterField): boolean {
  if (field.kind === 'text') return field.required !== false;
  return field.kind !== 'schedule';
}

/**
 * What each question starts as: a text's default in the reader's language,
 * a choice's default, and the project the gallery was opened in. Schedule
 * questions are not here — the form holds them as a schedule draft.
 */
export function initialAnswers(
  card: StarterCard,
  options: { locale: string; projectId?: string },
): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const field of card.fields) {
    if (field.kind === 'text') {
      answers[field.id] =
        field.i18n?.[baseLocale(options.locale)]?.default ??
        field.default ??
        '';
    } else if (field.kind === 'choice') {
      answers[field.id] = field.default ?? '';
    } else if (field.kind === 'project') {
      answers[field.id] = options.projectId ?? '';
    } else if (field.kind !== 'schedule') {
      answers[field.id] = '';
    }
  }
  return answers;
}

/** The ids of the questions that must be answered and are still blank. */
export function unansweredFields(
  card: StarterCard,
  answers: Readonly<Record<string, string>>,
): string[] {
  return card.fields
    .filter(
      (field) =>
        isRequiredField(field) && (answers[field.id] ?? '').trim() === '',
    )
    .map((field) => field.id);
}

/** Whether a starter matches what the reader typed, in their language or
 * in English. */
export function starterMatches(
  card: StarterCard,
  query: string,
  locale: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  const own = starterWords(card, locale);
  return [own.name, own.description ?? '', card.name, card.description ?? '']
    .join('\n')
    .toLowerCase()
    .includes(needle);
}
