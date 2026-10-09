/**
 * Work items people create: tasks (title, description, priority, labels,
 * due date), project names, comments, contacts and the searches they run.
 * Field shapes follow the platform's own schemas: task labels are the
 * project's predefined trio (a user path refuses unknown labels), contact
 * fields respect `backend/domains/contacts/input-schema.ts` (an e-mail, a
 * phone of digits and punctuation, a locale like `de-CH`, ≤ 50 tags).
 */

import type { TaskPriority } from '../api/tasks.ts';
import type { ContactInput } from '../api/workspace.ts';
import type { DataLocale, UserFaker } from './faker.ts';
import {
  type Random,
  chance,
  intBetween,
  pick,
  pickWeighted,
} from './random.ts';

/** The labels every project is created with (`PREDEFINED_TASK_LABELS`). */
export const PREDEFINED_LABELS = ['bug', 'feature', 'improvement'] as const;

const PRIORITY_WEIGHTS: readonly (readonly [TaskPriority, number])[] = [
  ['p0', 5],
  ['p1', 20],
  ['p2', 50],
  ['p3', 25],
];

const TASK_VERBS: Record<DataLocale, readonly string[]> = {
  en: [
    'Fix',
    'Review',
    'Update',
    'Prepare',
    'Draft',
    'Follow up on',
    'Investigate',
    'Clean up',
  ],
  de: [
    'Korrigieren:',
    'Prüfen:',
    'Aktualisieren:',
    'Vorbereiten:',
    'Nachfassen:',
    'Klären:',
  ],
  fr: [
    'Corriger',
    'Relire',
    'Mettre à jour',
    'Préparer',
    'Relancer',
    'Analyser',
  ],
};

export interface TaskDraft {
  title: string;
  description: string | undefined;
  priority: TaskPriority;
  labels: string[];
  /** Epoch ms, or undefined for no due date. */
  dueDate: number | undefined;
}

/** A task as people file them: a verb and an object, sometimes a ticket. */
export function taskDraft(
  data: UserFaker,
  random: Random,
  now: number = Date.now(),
): TaskDraft {
  const faker = data.get();
  const verb = pick(random, TASK_VERBS[data.locale]) ?? 'Review';
  const object =
    pick(random, [
      () => faker.commerce.productName(),
      () => `${faker.hacker.adjective()} ${faker.hacker.noun()}`,
      () =>
        `invoice ${faker.finance.accountNumber(6)} for ${faker.company.name()}`,
      () => `${faker.company.buzzNoun()} rollout`,
    ])?.() ?? 'the backlog';
  const description = chance(random, 0.7)
    ? [
        faker.lorem.sentences({ min: 1, max: 4 }),
        chance(random, 0.4)
          ? `\n\n- [ ] ${faker.hacker.phrase()}\n- [ ] ${faker.company.catchPhrase()}`
          : '',
      ].join('')
    : undefined;
  const labels = PREDEFINED_LABELS.filter(() => chance(random, 0.25));
  return {
    title: `${verb} ${object}`.slice(0, 200),
    description,
    priority: pickWeighted(random, PRIORITY_WEIGHTS) ?? 'p2',
    labels,
    dueDate: chance(random, 0.5)
      ? now + intBetween(random, 1, 45) * 86_400_000
      : undefined,
  };
}

/** A comment on a task: a status note, a question, a mention-free reply. */
export function taskComment(data: UserFaker, random: Random): string {
  const faker = data.get();
  const options: Record<DataLocale, readonly (() => string)[]> = {
    en: [
      () => `Looked into this — ${faker.lorem.sentence()}`,
      () =>
        `Blocked on ${faker.company.name()} until ${faker.date.soon({ days: 10 }).toDateString()}.`,
      () => 'Done on my side, can someone review?',
      () => `${faker.hacker.phrase()} Should we split this task?`,
    ],
    de: [
      () => `Habe nachgeschaut — ${faker.lorem.sentence()}`,
      () => 'Von meiner Seite erledigt, kann jemand prüfen?',
      () => `Wir warten auf ${faker.company.name()}.`,
    ],
    fr: [
      () => `J'ai regardé — ${faker.lorem.sentence()}`,
      () => 'Terminé de mon côté, quelqu’un peut relire ?',
      () => `En attente de ${faker.company.name()}.`,
    ],
  };
  return (pick(random, options[data.locale])?.() ?? 'Update').slice(0, 2_000);
}

/** A project name and description (names are capped at 80 characters). */
export function projectDraft(
  data: UserFaker,
  random: Random,
): { name: string; description: string } {
  const faker = data.get();
  const name =
    pick(random, [
      () =>
        `${faker.commerce.department()} ${faker.date.future().getFullYear()}`,
      () => `${faker.company.buzzAdjective()} ${faker.company.buzzNoun()}`,
      () => `${faker.location.city()} launch`,
    ])?.() ?? 'Project';
  return {
    name: name.slice(0, 80),
    description: faker.company.catchPhrase().slice(0, 500),
  };
}

const CONTACT_LOCALES: Record<DataLocale, readonly string[]> = {
  en: ['en', 'en-GB', 'en-US'],
  de: ['de', 'de-CH', 'de-DE'],
  fr: ['fr', 'fr-CH', 'fr-FR'],
};

/** A CRM contact as an editor types it in. */
export function contactDraft(
  data: UserFaker,
  random: Random,
  uniqueSuffix: string,
): ContactInput {
  const faker = data.get();
  const first = faker.person.firstName();
  const last = faker.person.lastName();
  const domain = faker.internet.domainName();
  const local = `${first}.${last}`
    .normalize('NFKD')
    .replace(/[^\w.]/g, '')
    .toLowerCase()
    .slice(0, 40);
  const tags = [
    'lead',
    'customer',
    'partner',
    'vip',
    'newsletter',
    'trial',
  ].filter(() => chance(random, 0.3));
  return {
    name: `${first} ${last}`,
    // A per-user suffix keeps two users' identical names from colliding on
    // the directory's duplicate-e-mail check.
    email: `${local || 'contact'}.${uniqueSuffix}@${domain}`,
    phone: `+41 ${intBetween(random, 21, 79)} ${intBetween(random, 100, 999)} ${intBetween(random, 10, 99)} ${intBetween(random, 10, 99)}`,
    locale: pick(random, CONTACT_LOCALES[data.locale]) ?? 'en',
    tags,
    notes: chance(random, 0.5) ? faker.lorem.sentences(2) : undefined,
    address: chance(random, 0.4)
      ? {
          street: faker.location.streetAddress(),
          city: faker.location.city(),
          country: faker.location.country(),
        }
      : undefined,
    source: 'manual_import',
  };
}

/** A short search people type into a list's search box. */
export function searchTerm(data: UserFaker, random: Random): string {
  const faker = data.get();
  return (
    pick(random, [
      () => faker.commerce.product(),
      () => faker.company.buzzNoun(),
      () => faker.person.lastName(),
      () => faker.lorem.word(),
      () => faker.commerce.department(),
    ])?.() ?? 'report'
  ).slice(0, 60);
}

/** A display name, for the account form. */
export function displayName(data: UserFaker): string {
  return data.get().person.fullName().slice(0, 200);
}

/** Custom instructions people give the assistant. */
export function customInstructions(data: UserFaker, random: Random): string {
  const faker = data.get();
  const lines = [
    `I work at ${faker.company.name()} as ${faker.person.jobTitle()}.`,
    pick(random, [
      'Answer briefly and use bullet points.',
      'Always answer in the language I write in.',
      'Prefer tables when comparing options.',
      'Explain like I am new to the topic.',
    ]) ?? '',
    chance(random, 0.3) ? faker.lorem.paragraph() : '',
  ];
  return lines
    .filter((line) => line !== '')
    .join('\n')
    .slice(0, 20_000);
}
