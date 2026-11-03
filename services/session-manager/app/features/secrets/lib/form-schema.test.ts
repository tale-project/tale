import { describe, expect, it } from 'vitest';

import { MAX_LABEL, MAX_TITLE, MAX_VALUE } from '@/lib/secret-limits';
import { meta } from '@/tests/utils/fixtures';

import { customRow, startingRows, type FormValues } from './form';
import { secretFormSchema, type FormMessages } from './form-schema';

const messages: FormMessages = {
  titleRequired: 'title required',
  titleTooLong: 'title too long',
  labelRequired: 'label required',
  labelTooLong: 'label too long',
  valueTooLong: (label) => `value of ${label} too long`,
  noValues: 'no values',
  tooMany: 'too many',
};
const schema = secretFormSchema(messages);

function credentialsKind() {
  const found = meta().secretKinds.find((kind) => kind.key === 'credentials');
  if (found === undefined) throw new Error('No credentials kind');
  return found;
}

function form(overrides: Partial<FormValues> = {}): FormValues {
  const rows = startingRows(credentialsKind());
  const website = rows.find((row) => row.label === 'Website');
  if (website !== undefined) website.value = 'example.com';
  return {
    kind: 'credentials',
    title: 'Shop',
    scope: 'global',
    rows,
    ...overrides,
  };
}

/** What the schema refuses: message by path. */
function issues(values: FormValues): Array<[string, string]> {
  const result = schema.safeParse(values);
  if (result.success) return [];
  return result.error.issues.map((issue) => [
    issue.path.join('.'),
    issue.message,
  ]);
}

describe('secretFormSchema', () => {
  it('accepts a secret with a title and a value', () => {
    expect(schema.safeParse(form()).success).toBe(true);
  });

  it('words each refusal beside the field it belongs to', () => {
    const rows = [
      ...form().rows,
      customRow({ value: 'no label' }),
      customRow({ label: 'a'.repeat(MAX_LABEL + 1), value: 'x' }),
      customRow({ label: 'Long', value: 'v'.repeat(MAX_VALUE + 1) }),
    ];
    expect(issues(form({ title: '', rows }))).toEqual([
      ['title', 'title required'],
      ['rows.3.label', 'label required'],
      ['rows.4.label', 'label too long'],
      ['rows.5.value', 'value of Long too long'],
    ]);
  });

  it('refuses a title that is too long', () => {
    expect(issues(form({ title: 'a'.repeat(MAX_TITLE + 1) }))).toEqual([
      ['title', 'title too long'],
    ]);
  });

  it('refuses a secret without a value, under rows.root so no field takes the blame', () => {
    const rows = startingRows(credentialsKind());
    expect(issues(form({ rows }))).toEqual([['rows.root', 'no values']]);
  });

  it('refuses a secret with more values than it can hold', () => {
    const rows = Array.from({ length: 41 }, (_value, index) =>
      customRow({ label: `L${index}`, value: 'x' }),
    );
    expect(issues(form({ rows }))).toEqual([['rows.root', 'too many']]);
  });

  it('refuses a kind that does not exist', () => {
    const result = schema.safeParse({ ...form(), kind: 'wallet' });
    expect(result.success).toBe(false);
  });
});
