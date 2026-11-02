import { describe, expect, it } from 'vitest';

import type { SecretKind, SecretKindInfo } from '@/lib/api/schemas';
import {
  MAX_FIELDS,
  MAX_LABEL,
  MAX_TITLE,
  MAX_VALUE,
} from '@/lib/secret-limits';
import { meta, secret, sessionRef } from '@/tests/utils/fixtures';
import { field } from '@/tests/utils/secrets-api';

import {
  customRow,
  fieldsToSend,
  isPristine,
  problemsOf,
  rowsFromSecret,
  startingRows,
  switchKind,
  toCreateBody,
  toUpdateBody,
  type FormValues,
  type RowValues,
} from './form';

function kindOf(key: SecretKind): SecretKindInfo {
  const found = meta().secretKinds.find((kind) => kind.key === key);
  if (found === undefined) throw new Error(`No kind ${key}`);
  return found;
}

/** A form of a kind as it opens, with what a test changes. */
function formOf(
  kind: SecretKind,
  overrides: Partial<FormValues> = {},
): FormValues {
  return {
    kind,
    title: '',
    scope: 'global',
    rows: startingRows(kindOf(kind)),
    ...overrides,
  };
}

/** The rows of a form with these values typed, by label. */
function typed(rows: RowValues[], values: Record<string, string>): RowValues[] {
  return rows.map((row) =>
    row.label in values ? { ...row, value: values[row.label] ?? '' } : row,
  );
}

describe('startingRows', () => {
  it('has one empty row for each field the kind starts with, in its order', () => {
    expect(startingRows(kindOf('credentials'))).toEqual([
      {
        template: 'Website',
        multiline: false,
        label: 'Website',
        value: '',
        hidden: false,
        decided: false,
      },
      {
        template: 'Username',
        multiline: false,
        label: 'Username',
        value: '',
        hidden: false,
        decided: false,
      },
      {
        template: 'Password',
        multiline: false,
        label: 'Password',
        value: '',
        hidden: true,
        decided: false,
      },
    ]);
  });

  it('hides what the kind hides: a password, a card number and the CVC', () => {
    const hidden = (key: SecretKind) =>
      startingRows(kindOf(key))
        .filter((row) => row.hidden)
        .map((row) => row.label);
    expect(hidden('credentials')).toEqual(['Password']);
    expect(hidden('card')).toEqual(['Card number', 'CVC']);
    expect(hidden('personal')).toEqual([]);
    expect(hidden('note')).toEqual([]);
  });

  it('makes the rows the server marks multiline text areas', () => {
    const multiline = (key: SecretKind) =>
      startingRows(kindOf(key))
        .filter((row) => row.multiline)
        .map((row) => row.label);
    expect(multiline('personal')).toEqual(['Address', 'Company address']);
    expect(multiline('note')).toEqual(['Note']);
    expect(multiline('card')).toEqual([]);
  });

  it('starts a note with its single text', () => {
    expect(startingRows(kindOf('note')).map((row) => row.label)).toEqual([
      'Note',
    ]);
  });
});

describe('customRow', () => {
  it('is an empty row with a label to type, not hidden and not decided', () => {
    expect(customRow()).toEqual({
      template: null,
      multiline: false,
      label: '',
      value: '',
      hidden: false,
      decided: false,
    });
  });

  it('takes what it is given', () => {
    expect(customRow({ label: 'PIN', hidden: true }).label).toBe('PIN');
  });
});

describe('rowsFromSecret', () => {
  it("fills the kind's starting rows from the stored fields, whatever the case of their labels", () => {
    const rows = rowsFromSecret(kindOf('credentials'), [
      field('password', 'pw', true),
      field('WEBSITE', 'example.com'),
    ]);
    expect(rows.map((row) => [row.template, row.label, row.value])).toEqual([
      ['Website', 'WEBSITE', 'example.com'],
      ['Username', 'Username', ''],
      ['Password', 'password', 'pw'],
    ]);
  });

  it('keeps the label the secret has stored, so saving does not rename it', () => {
    const [row] = rowsFromSecret(kindOf('credentials'), [
      field('website', 'example.com'),
    ]);
    expect(row?.label).toBe('website');
  });

  it('adds the other fields as rows of their own, in the order saved', () => {
    const rows = rowsFromSecret(kindOf('credentials'), [
      field('Backup code', '1234', true),
      field('Website', 'example.com'),
      field('Security answer', 'Rex'),
    ]);
    expect(rows.slice(3).map((row) => [row.label, row.template])).toEqual([
      ['Backup code', null],
      ['Security answer', null],
    ]);
  });

  it('keeps the stored flag of every field as a decision', () => {
    const rows = rowsFromSecret(kindOf('credentials'), [
      field('Website', 'example.com'),
      field('Notes', 'plain', false),
      field('PIN', '1', true),
    ]);
    const filled = rows.filter((row) => row.value !== '');
    expect(filled.every((row) => row.decided)).toBe(true);
    expect(filled.map((row) => row.hidden)).toEqual([false, false, true]);
  });

  it('leaves the starting rows that the secret has no field for as they start', () => {
    const rows = rowsFromSecret(kindOf('card'), [field('Cardholder', 'Ada')]);
    expect(rows[1]).toMatchObject({
      label: 'Card number',
      value: '',
      hidden: true,
      decided: false,
    });
  });

  it('gives a value of several lines a text area, as an input would flatten it', () => {
    const rows = rowsFromSecret(kindOf('credentials'), [
      field('Website', 'a\nb'),
      field('Extra', 'x\ny'),
    ]);
    expect(rows[0]?.multiline).toBe(true);
    expect(rows[3]?.multiline).toBe(true);
    expect(rows[1]?.multiline).toBe(false);
  });

  it('uses a kind of the server that this client does not know by its own rows only', () => {
    const rows = rowsFromSecret({ key: 'note', label: 'Note', fields: [] }, [
      field('Anything', 'value'),
    ]);
    expect(rows.map((row) => row.label)).toEqual(['Anything']);
  });
});

describe('switchKind', () => {
  const same = (label: string) => label;

  it("is the new kind's starting rows when nothing was typed", () => {
    const rows = switchKind(
      startingRows(kindOf('credentials')),
      kindOf('card'),
      same,
    );
    expect(rows).toEqual(startingRows(kindOf('card')));
  });

  it('carries a value to the starting row of the new kind that has the same label', () => {
    const rows = switchKind(
      [
        ...typed(startingRows(kindOf('personal')), { Name: 'Ada' }),
        customRow({ label: 'Cardholder', value: 'Ada L.' }),
      ],
      kindOf('card'),
      same,
    );
    expect(rows.find((row) => row.label === 'Cardholder')?.value).toBe(
      'Ada L.',
    );
    // The typed Name has no starting row in a card: it stays, as a row of its own.
    expect(rows.find((row) => row.value === 'Ada')).toMatchObject({
      template: null,
      label: 'Name',
    });
  });

  it('never loses a typed value: it stays as a row of its own, with its label in the language shown', () => {
    const rows = switchKind(
      typed(startingRows(kindOf('credentials')), { Username: 'ada' }),
      kindOf('note'),
      (label) => `[${label}]`,
    );
    expect(rows.map((row) => [row.label, row.value, row.template])).toEqual([
      ['Note', '', 'Note'],
      ['[Username]', 'ada', null],
    ]);
  });

  it('keeps a hidden value hidden', () => {
    const rows = switchKind(
      [
        customRow({
          label: 'Password',
          value: 'pw',
          hidden: true,
          decided: true,
        }),
      ],
      kindOf('credentials'),
      same,
    );
    const password = rows.find((row) => row.label === 'Password');
    expect(password).toMatchObject({
      value: 'pw',
      hidden: true,
      decided: true,
    });
  });

  it('keeps the rows the person added, with their label, and drops the ones left empty', () => {
    const rows = switchKind(
      [
        ...startingRows(kindOf('credentials')),
        customRow({ label: 'PIN', value: '12' }),
        customRow({ label: 'Only a label' }),
        customRow(),
      ],
      kindOf('personal'),
      same,
    );
    expect(rows.filter((row) => row.template === null)).toMatchObject([
      { label: 'PIN', value: '12' },
      { label: 'Only a label', value: '' },
    ]);
  });

  it('gives a carried value of several lines a text area', () => {
    const rows = switchKind(
      [customRow({ label: 'Other', value: 'a\nb' })],
      kindOf('note'),
      same,
    );
    expect(rows.find((row) => row.label === 'Other')?.multiline).toBe(true);
  });
});

describe('isPristine', () => {
  const opened = formOf('credentials');

  it('is true for the form as it opened', () => {
    expect(isPristine(opened, opened)).toBe(true);
  });

  it('is false once something is typed in a starting row', () => {
    const rows = typed(opened.rows, { Website: 'x' });
    expect(isPristine({ ...opened, rows }, opened)).toBe(false);
  });

  it('is false once a title is typed, but not for blanks around it', () => {
    expect(isPristine({ ...opened, title: 'Shop' }, opened)).toBe(false);
    expect(isPristine({ ...opened, title: '   ' }, opened)).toBe(true);
  });

  it('is false once the secret is made for a session', () => {
    expect(isPristine({ ...opened, scope: '3' }, opened)).toBe(false);
  });

  it('does not count an added row that is still empty', () => {
    const rows = [...opened.rows, customRow()];
    expect(isPristine({ ...opened, rows }, opened)).toBe(true);
  });

  it('counts an added row with a label, as it can be lost', () => {
    const rows = [...opened.rows, customRow({ label: 'PIN' })];
    expect(isPristine({ ...opened, rows }, opened)).toBe(false);
  });

  it('is false for an edit of a stored value and true again when it is put back', () => {
    const stored = rowsFromSecret(kindOf('credentials'), [
      field('Website', 'a.test'),
    ]);
    const base: FormValues = formOf('credentials', {
      title: 'Shop',
      rows: stored,
    });
    const changed = typed(stored, { Website: 'b.test' });
    expect(isPristine({ ...base, rows: changed }, base)).toBe(false);
    expect(isPristine({ ...base, rows: stored }, base)).toBe(true);
  });

  it('is false once a filled row is made hidden or shown', () => {
    const rows = typed(opened.rows, { Website: 'x' });
    const toggled = rows.map((row) =>
      row.label === 'Website' ? { ...row, hidden: true } : row,
    );
    expect(isPristine({ ...opened, rows: toggled }, { ...opened, rows })).toBe(
      false,
    );
  });

  it('is not changed by toggling an empty row, where nothing could be lost', () => {
    const toggled = opened.rows.map((row) =>
      row.label === 'Website' ? { ...row, hidden: true, decided: true } : row,
    );
    expect(isPristine({ ...opened, rows: toggled }, opened)).toBe(true);
  });
});

describe('fieldsToSend', () => {
  it('drops the rows without a value, with their labels', () => {
    const rows = [
      ...typed(startingRows(kindOf('credentials')), { Website: 'a.test' }),
      customRow({ label: 'Only a label' }),
      customRow({ label: 'Blank', value: '   ' }),
    ];
    expect(fieldsToSend(rows).map((entry) => entry.label)).toEqual(['Website']);
  });

  it('sends the labels trimmed, and the values as typed (the server trims the visible ones)', () => {
    const rows = [customRow({ label: '  PIN ', value: ' 12 ' })];
    expect(fieldsToSend(rows)).toEqual([{ label: 'PIN', value: ' 12 ' }]);
  });

  it('sends a hidden row as hidden', () => {
    const [password] = fieldsToSend(
      typed(startingRows(kindOf('credentials')), { Password: 'pw' }),
    );
    expect(password).toEqual({ label: 'Password', value: 'pw', hidden: true });
  });

  it('sends nothing about a row left to the server (it masks a card number or a private label itself)', () => {
    const [entry] = fieldsToSend([
      customRow({ label: 'Number', value: '4242' }),
    ]);
    expect(entry).toEqual({ label: 'Number', value: '4242' });
    expect(entry).not.toHaveProperty('hidden');
  });

  it('sends false for a flag the person or the secret decided', () => {
    const [entry] = fieldsToSend([
      customRow({
        label: 'Pass phrase',
        value: 'x',
        hidden: false,
        decided: true,
      }),
    ]);
    expect(entry).toEqual({ label: 'Pass phrase', value: 'x', hidden: false });
  });
});

describe('toCreateBody', () => {
  it('sends the kind, the title trimmed, the fields with a value and who it is for', () => {
    const values = formOf('credentials', {
      title: '  Example shop ',
      rows: typed(startingRows(kindOf('credentials')), {
        Website: 'example.com',
        Password: 'pw',
      }),
    });
    expect(toCreateBody(values)).toEqual({
      kind: 'credentials',
      title: 'Example shop',
      sessionId: null,
      fields: [
        { label: 'Website', value: 'example.com' },
        { label: 'Password', value: 'pw', hidden: true },
      ],
    });
  });

  it('names the session of a secret for one session', () => {
    const body = toCreateBody(formOf('note', { title: 'n', scope: '12' }));
    expect(body.sessionId).toBe(12);
  });
});

describe('toUpdateBody', () => {
  const stored = secret({
    id: 9,
    kind: 'credentials',
    title: 'Example shop',
    session: sessionRef({ id: 3, name: '0003' }),
    fields: [
      field('Website', 'example.com'),
      field('Username', 'ada'),
      field('Password', 'pw', true),
      field('Backup code', '1234', true),
    ],
  });
  const opened: FormValues = {
    kind: 'credentials',
    title: 'Example shop',
    scope: '3',
    rows: rowsFromSecret(kindOf('credentials'), stored.fields),
  };

  it('is empty when nothing changed', () => {
    expect(toUpdateBody(opened, stored)).toEqual({});
  });

  it('is empty when only blanks changed', () => {
    const rows = [...opened.rows, customRow()];
    expect(
      toUpdateBody({ ...opened, title: ' Example shop ', rows }, stored),
    ).toEqual({});
  });

  it('sends only the title when only the title changed', () => {
    expect(toUpdateBody({ ...opened, title: 'Shop' }, stored)).toEqual({
      title: 'Shop',
    });
  });

  it('sends sessionId null when the secret becomes one for every session', () => {
    const update = toUpdateBody({ ...opened, scope: 'global' }, stored);
    expect(update).toEqual({ sessionId: null });
    expect('sessionId' in update).toBe(true);
  });

  it('sends the id of the session when the secret moves to another one', () => {
    expect(toUpdateBody({ ...opened, scope: '12' }, stored)).toEqual({
      sessionId: 12,
    });
  });

  it('sends the session of a secret that was for every session', () => {
    const global = { ...stored, session: null };
    expect(toUpdateBody({ ...opened, scope: '12' }, global)).toEqual({
      sessionId: 12,
    });
    expect(toUpdateBody({ ...opened, scope: 'global' }, global)).toEqual({});
  });

  it('sends all the fields, with the flags they have, when one value changed', () => {
    const rows = typed(opened.rows, { Username: 'ada2' });
    expect(toUpdateBody({ ...opened, rows }, stored)).toEqual({
      fields: [
        { label: 'Website', value: 'example.com', hidden: false },
        { label: 'Username', value: 'ada2', hidden: false },
        { label: 'Password', value: 'pw', hidden: true },
        { label: 'Backup code', value: '1234', hidden: true },
      ],
    });
  });

  it('sends the fields when a value is cleared (the server drops it)', () => {
    const rows = typed(opened.rows, { Username: '' });
    const update = toUpdateBody({ ...opened, rows }, stored);
    expect(update.fields?.map((entry) => entry.label)).toEqual([
      'Website',
      'Password',
      'Backup code',
    ]);
  });

  it('sends the fields when a row is added or removed', () => {
    const added = [...opened.rows, customRow({ label: 'PIN', value: '1' })];
    expect(
      toUpdateBody({ ...opened, rows: added }, stored).fields,
    ).toHaveLength(5);
    const removed = opened.rows.filter((row) => row.label !== 'Backup code');
    expect(
      toUpdateBody({ ...opened, rows: removed }, stored).fields,
    ).toHaveLength(3);
  });

  it('sends the fields when only a flag changed', () => {
    const rows = opened.rows.map((row) =>
      row.label === 'Website' ? { ...row, hidden: true, decided: true } : row,
    );
    const update = toUpdateBody({ ...opened, rows }, stored);
    expect(update.fields?.[0]).toEqual({
      label: 'Website',
      value: 'example.com',
      hidden: true,
    });
  });

  it('does not send the fields of a secret whose fields are stored in another order', () => {
    const shuffled = secret({
      ...stored,
      fields: [...stored.fields].reverse(),
    });
    const rows = rowsFromSecret(kindOf('credentials'), shuffled.fields);
    expect(toUpdateBody({ ...opened, rows, title: 'Shop' }, shuffled)).toEqual({
      title: 'Shop',
    });
  });

  it('does not rename a field the secret stores under another case', () => {
    const odd = secret({
      ...stored,
      fields: [field('password', 'pw', true), field('Website', 'example.com')],
    });
    const rows = rowsFromSecret(kindOf('credentials'), odd.fields);
    expect(toUpdateBody({ ...opened, rows }, odd)).toEqual({});
    const changed = typed(rows, { password: 'new' });
    expect(
      toUpdateBody({ ...opened, rows: changed }, odd).fields?.map(
        (e) => e.label,
      ),
    ).toEqual(['Website', 'password']);
  });

  it('keeps a hidden value as typed, spaces included, and compares it so', () => {
    const spaced = secret({
      ...stored,
      fields: [field('Password', ' pw ', true)],
    });
    const rows = rowsFromSecret(kindOf('credentials'), spaced.fields);
    expect(toUpdateBody({ ...opened, rows }, spaced)).toEqual({});
    const trimmed = typed(rows, { Password: 'pw' });
    expect(toUpdateBody({ ...opened, rows: trimmed }, spaced).fields).toEqual([
      { label: 'Password', value: 'pw', hidden: true },
    ]);
  });
});

describe('problemsOf', () => {
  const valid = formOf('credentials', {
    title: 'Shop',
    rows: typed(startingRows(kindOf('credentials')), { Website: 'x' }),
  });

  it('finds nothing wrong with a title and a value', () => {
    const problems = problemsOf(valid);
    expect(problems).toMatchObject({ noValues: false, tooMany: false });
    expect(problems.title).toBeUndefined();
    expect(problems.rows.every((row) => Object.keys(row).length === 0)).toBe(
      true,
    );
  });

  it('wants a title', () => {
    expect(problemsOf({ ...valid, title: '  ' }).title).toBe('titleRequired');
  });

  it('allows a title of the longest length and refuses one character more', () => {
    expect(
      problemsOf({ ...valid, title: 'a'.repeat(MAX_TITLE) }).title,
    ).toBeUndefined();
    expect(
      problemsOf({ ...valid, title: 'a'.repeat(MAX_TITLE + 1) }).title,
    ).toBe('titleTooLong');
  });

  it('counts the length of a title without the blanks around it', () => {
    const padded = ` ${'a'.repeat(MAX_TITLE)} `;
    expect(problemsOf({ ...valid, title: padded }).title).toBeUndefined();
  });

  it('wants at least one value', () => {
    const none = { ...valid, rows: startingRows(kindOf('credentials')) };
    expect(problemsOf(none).noValues).toBe(true);
  });

  it('does not count a value of blanks', () => {
    const rows = typed(startingRows(kindOf('credentials')), { Website: '   ' });
    expect(problemsOf({ ...valid, rows }).noValues).toBe(true);
  });

  it('wants a label for a value on a row the person added', () => {
    const rows = [...valid.rows, customRow({ value: 'x' })];
    expect(problemsOf({ ...valid, rows }).rows[3]).toEqual({
      label: 'labelRequired',
    });
  });

  it('does not check a row without a value, whatever its label', () => {
    const rows = [
      ...valid.rows,
      customRow({ label: 'a'.repeat(MAX_LABEL + 5) }),
    ];
    expect(problemsOf({ ...valid, rows }).rows[3]).toEqual({});
  });

  it('refuses a label that is too long', () => {
    const at = [
      ...valid.rows,
      customRow({ label: 'a'.repeat(MAX_LABEL), value: 'x' }),
    ];
    expect(problemsOf({ ...valid, rows: at }).rows[3]).toEqual({});
    const over = [
      ...valid.rows,
      customRow({ label: 'a'.repeat(MAX_LABEL + 1), value: 'x' }),
    ];
    expect(problemsOf({ ...valid, rows: over }).rows[3]).toEqual({
      label: 'labelTooLong',
    });
  });

  it('refuses a value that is too long, trimmed unless it is hidden', () => {
    const edge = 'a'.repeat(MAX_VALUE);
    const visible = typed(valid.rows, { Website: ` ${edge} ` });
    expect(problemsOf({ ...valid, rows: visible }).rows[0]).toEqual({});
    const over = typed(valid.rows, { Website: `${edge}a` });
    expect(problemsOf({ ...valid, rows: over }).rows[0]).toEqual({
      value: 'valueTooLong',
    });
    const hidden = typed(valid.rows, { Password: ` ${edge} ` });
    expect(problemsOf({ ...valid, rows: hidden }).rows[2]).toEqual({
      value: 'valueTooLong',
    });
  });

  it('allows as many values as a secret can hold and refuses one more', () => {
    const row = (index: number) =>
      customRow({ label: `L${index}`, value: 'x' });
    const full = Array.from({ length: MAX_FIELDS }, (_value, index) =>
      row(index),
    );
    expect(problemsOf({ ...valid, rows: full }).tooMany).toBe(false);
    expect(
      problemsOf({ ...valid, rows: [...full, row(MAX_FIELDS)] }).tooMany,
    ).toBe(true);
  });

  it('counts only the rows that have a value toward the most a secret can hold', () => {
    const empties = Array.from({ length: MAX_FIELDS + 5 }, () => customRow());
    const rows = [...valid.rows, ...empties];
    expect(problemsOf({ ...valid, rows }).tooMany).toBe(false);
  });

  it('reports a problem at the index of its row', () => {
    const rows = [
      customRow({ label: 'ok', value: 'x' }),
      customRow({ value: 'no label' }),
      customRow({ label: 'a'.repeat(MAX_LABEL + 1), value: 'x' }),
    ];
    const problems = problemsOf({ ...valid, rows });
    expect(problems.rows.map((row) => row.label)).toEqual([
      undefined,
      'labelRequired',
      'labelTooLong',
    ]);
  });
});
