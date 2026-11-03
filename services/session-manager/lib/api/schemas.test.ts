import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { MAX_PROXY_IMPORT, MAX_PROXY_LINE } from '../proxy-limits.ts';
import {
  MAX_FIELDS,
  MAX_LABEL,
  MAX_TITLE,
  MAX_VALUE,
} from '../secret-limits.ts';
import { SESSION_NAME_MAX_LENGTH } from '../session-name.ts';
import {
  proxyCreateSchema,
  proxyImportSchema,
  secretCreateSchema,
  secretUpdateSchema,
  sessionCreateSchema,
  sessionUpdateSchema,
  settingsUpdateSchema,
} from './schemas.ts';

/** Where the schema refuses the input (`proxy`, `fields.0.label`), or null if it takes it. */
function refusedAt(schema: z.ZodType, input: unknown): string | null {
  const result = schema.safeParse(input);
  if (result.success) return null;
  return result.error.issues[0]?.path.join('.') ?? '';
}

const HUGE = 1_000_000;

describe('a proxy', () => {
  it('may have a line of the longest length, counted in characters', () => {
    expect(
      refusedAt(proxyCreateSchema, { proxy: 'p'.repeat(MAX_PROXY_LINE) }),
    ).toBeNull();
    // 4096 UTF-16 units, 2048 characters.
    expect(
      refusedAt(proxyCreateSchema, { proxy: '😀'.repeat(MAX_PROXY_LINE) }),
    ).toBeNull();
  });

  it('is refused with a line longer than that, naming the field', () => {
    expect(
      refusedAt(proxyCreateSchema, { proxy: 'p'.repeat(MAX_PROXY_LINE + 1) }),
    ).toBe('proxy');
    expect(refusedAt(proxyCreateSchema, { proxy: 'p'.repeat(HUGE) })).toBe(
      'proxy',
    );
  });

  it('says how much is allowed, and never shows the line', () => {
    const result = proxyCreateSchema.safeParse({
      proxy: `user:hunter2@${'p'.repeat(MAX_PROXY_LINE)}`,
    });
    expect(result.success).toBe(false);
    const text = JSON.stringify(result.error?.issues);
    expect(text).toContain(String(MAX_PROXY_LINE));
    expect(text).not.toContain('hunter2');
  });

  it('may be imported as a list of the largest size, and no larger', () => {
    expect(
      refusedAt(proxyImportSchema, { text: 'x'.repeat(MAX_PROXY_IMPORT) }),
    ).toBeNull();
    expect(
      refusedAt(proxyImportSchema, { text: 'x'.repeat(MAX_PROXY_IMPORT + 1) }),
    ).toBe('text');
  });
});

describe('the name of a session', () => {
  it('still reaches the rule of the server near the limit: it answers invalid_name', () => {
    for (const name of [
      'x'.repeat(SESSION_NAME_MAX_LENGTH + 1),
      `${' '.repeat(50)}${'x'.repeat(SESSION_NAME_MAX_LENGTH)}${' '.repeat(50)}`,
      '😀'.repeat(SESSION_NAME_MAX_LENGTH + 1),
    ]) {
      expect(refusedAt(sessionCreateSchema, { name })).toBeNull();
      expect(refusedAt(sessionUpdateSchema, { name })).toBeNull();
    }
  });

  it('is refused when it is absurdly long', () => {
    expect(refusedAt(sessionCreateSchema, { name: 'x'.repeat(HUGE) })).toBe(
      'name',
    );
    expect(refusedAt(sessionUpdateSchema, { name: 'x'.repeat(HUGE) })).toBe(
      'name',
    );
  });

  it('may be left out or blank when a session is created', () => {
    expect(refusedAt(sessionCreateSchema, {})).toBeNull();
    expect(refusedAt(sessionCreateSchema, { name: null })).toBeNull();
    expect(refusedAt(sessionCreateSchema, { name: '' })).toBeNull();
  });
});

describe('the start page', () => {
  it('may be as long as a web address in a settings page can be', () => {
    expect(
      refusedAt(settingsUpdateSchema, {
        startPage: `https://example.com/${'a'.repeat(2000)}`,
      }),
    ).toBeNull();
    expect(refusedAt(settingsUpdateSchema, { startPage: null })).toBeNull();
    expect(refusedAt(settingsUpdateSchema, { startPage: '' })).toBeNull();
  });

  it('is refused when it is longer', () => {
    expect(
      refusedAt(settingsUpdateSchema, {
        startPage: `https://${'a'.repeat(2100)}`,
      }),
    ).toBe('startPage');
  });
});

describe('a secret', () => {
  const field = { label: 'Note', value: 'text' };

  it('still reaches the rules of the vault near their limits: they answer invalid_secret', () => {
    const body = {
      kind: 'note',
      title: 'x'.repeat(MAX_TITLE + 1),
      fields: [
        { label: 'x'.repeat(MAX_LABEL + 1), value: 'text' },
        { label: 'Note', value: 'x'.repeat(MAX_VALUE + 100) },
        // Blanks around a value are trimmed by the vault before it measures.
        { label: 'Note', value: `${' '.repeat(500)}text${' '.repeat(500)}` },
        ...Array.from({ length: MAX_FIELDS }, () => field),
      ],
    };
    expect(refusedAt(secretCreateSchema, body)).toBeNull();
    expect(refusedAt(secretUpdateSchema, body)).toBeNull();
  });

  it.each([
    ['title', { title: 'x'.repeat(HUGE), fields: [field] }, 'title'],
    [
      'label',
      { title: 't', fields: [{ label: 'x'.repeat(HUGE), value: 'v' }] },
      'fields.0.label',
    ],
    [
      'value',
      {
        title: 't',
        fields: [field, { label: 'Note', value: 'x'.repeat(HUGE) }],
      },
      'fields.1.value',
    ],
    [
      'number of fields',
      { title: 't', fields: Array.from({ length: 100_000 }, () => field) },
      'fields',
    ],
  ])('is refused with an absurd %s', (_what, rest, path) => {
    expect(refusedAt(secretCreateSchema, { kind: 'note', ...rest })).toBe(path);
    expect(refusedAt(secretUpdateSchema, rest)).toBe(path);
  });
});
