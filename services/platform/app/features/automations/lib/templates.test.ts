import { describe, expect, it } from 'vitest';

import {
  initialAnswers,
  listLines,
  sortTemplates,
  type TemplateCard,
  templateWords,
  unansweredFields,
  wireAnswers,
} from './templates';

function card(overrides: Partial<TemplateCard>): TemplateCard {
  return {
    slug: 'example',
    name: 'Example',
    category: 'tasks',
    labels: [],
    details: 'Does one thing.',
    i18n: {},
    scope: 'org',
    steps: [{ title: 'Does it' }],
    outcomes: [{ kind: 'creates', text: 'One thing.' }],
    worksWith: [],
    fields: [],
    connectors: [],
    trigger: null,
    inUse: 0,
    ...overrides,
  };
}

const QUESTIONS = card({
  fields: [
    {
      id: 'title',
      kind: 'text',
      label: 'Title',
      default: 'Digest',
      i18n: { de: { default: 'Übersicht' } },
    },
    { id: 'note', kind: 'text', label: 'Note', required: false },
    { id: 'batch', kind: 'number', label: 'Batch', min: 5, max: 50 },
    { id: 'drafts', kind: 'toggle', label: 'Drafts', default: true },
    { id: 'labels', kind: 'list', label: 'Labels', default: ['bug'] },
    {
      id: 'account',
      kind: 'credential',
      label: 'Account',
      connector: 'github',
    },
    {
      id: 'backup',
      kind: 'credential',
      label: 'Backup account',
      connector: 'github',
      required: false,
      placeholder: 'The default GitHub connection',
    },
    {
      id: 'mailbox',
      kind: 'choice',
      label: 'Mailbox',
      default: 'gmail',
      options: [
        { value: 'gmail', label: 'Gmail' },
        { value: 'outlook', label: 'Outlook' },
      ],
    },
    { id: 'when', kind: 'schedule', label: 'When' },
  ],
});

describe('a template’s questions in the form', () => {
  it('start from the template’s defaults, in the reader’s language, and the one credential in service', () => {
    expect(
      initialAnswers(QUESTIONS, {
        locale: 'de-CH',
        credentials: { github: [{ name: 'Work' }] },
      }),
    ).toEqual({
      title: 'Übersicht',
      note: '',
      batch: 5,
      drafts: true,
      labels: 'bug',
      account: 'Work',
      // An optional credential starts on its empty choice, one in service
      // or not.
      backup: '',
      mailbox: 'gmail',
    });
    // Two credentials in service: the reader picks.
    expect(
      initialAnswers(QUESTIONS, {
        locale: 'en',
        credentials: { github: [{ name: 'Work' }, { name: 'Home' }] },
      }).account,
    ).toBe('');
  });

  it('wait for every required answer, never for a number, a toggle or an optional one', () => {
    const answers = initialAnswers(QUESTIONS, { locale: 'en' });
    expect(unansweredFields(QUESTIONS.fields, answers)).toEqual(['account']);
    expect(
      unansweredFields(QUESTIONS.fields, { ...answers, account: 'Work' }),
    ).toEqual([]);
  });

  it('go to the server in the shape each question takes', () => {
    expect(
      wireAnswers(QUESTIONS.fields, {
        title: 'Digest',
        note: '  ',
        batch: 20,
        drafts: false,
        labels: ' bug \n\nui\n',
        account: 'Work',
        mailbox: 'outlook',
      }),
    ).toEqual({
      title: 'Digest',
      batch: 20,
      drafts: false,
      labels: ['bug', 'ui'],
      account: 'Work',
      mailbox: 'outlook',
    });
    expect(listLines('a\n\n b ')).toEqual(['a', 'b']);
  });
});

describe('the catalog’s order and words', () => {
  it('sorts by category, then by name as the reader reads it', () => {
    const sorted = sortTemplates(
      [
        card({ slug: 'z', name: 'Zeta', category: 'webhooks' }),
        card({ slug: 'b', name: 'Beta', category: 'tasks' }),
        card({ slug: 'a', name: 'Alpha', category: 'tasks' }),
        card({ slug: 'i', name: 'Inbox sync', category: 'inbox' }),
      ],
      'en',
    );
    expect(sorted.map((entry) => entry.slug)).toEqual(['i', 'a', 'b', 'z']);
  });

  it('reads a regional locale’s words through its language', () => {
    const worded = card({
      i18n: { de: { name: 'Beispiel', details: 'Tut eine Sache.' } },
    });
    expect(templateWords(worded, 'de-CH')).toMatchObject({
      name: 'Beispiel',
      details: 'Tut eine Sache.',
    });
    expect(templateWords(worded, 'fr').name).toBe('Example');
  });
});
