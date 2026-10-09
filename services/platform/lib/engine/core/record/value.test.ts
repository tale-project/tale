// @vitest-environment node

import { valueHash } from '@tale/ui/data/hash';
import { randomJson, seeded } from '@tale/ui/data/random-json';
import { describe, expect, it } from 'vitest';

import { boundJson } from '../../../shared/utils/bound-json';
import {
  boundRecorded,
  RECORD_LIMITS,
  RECORD_RUN_BUDGET,
  recordBudget,
  recordValue,
  redactValue,
  unlimitedBudget,
} from './value';

describe('redactValue', () => {
  it('withholds a member whose name marks a secret, and says where', () => {
    expect(
      redactValue({
        user: 'ada',
        password: 'hunter2',
        auth: { apiKey: 'k', scheme: 'basic' },
      }),
    ).toEqual({
      value: { user: 'ada', password: null, auth: null },
      redacted: [
        { pointer: '/password', why: 'key' },
        { pointer: '/auth', why: 'key' },
      ],
    });
  });

  it('withholds text that looks like a credential wherever it sits', () => {
    const token = `ghp_${'a'.repeat(30)}`;
    expect(
      redactValue({ notes: ['plain', `use ${token} here`], header: 'x' }),
    ).toEqual({
      value: { notes: ['plain', null], header: 'x' },
      redacted: [{ pointer: '/notes/1', why: 'pattern' }],
    });
  });

  it('withholds an opaque value under a credential name', () => {
    expect(redactValue({ list: [{ secret: 'abcdefghijklmnop' }] })).toEqual({
      value: { list: [{ secret: null }] },
      redacted: [{ pointer: '/list/0/secret', why: 'key' }],
    });
  });

  it('keeps counts and flags under a secret-looking name', () => {
    const usage = { inputTokens: 120, maxTokens: 4000, hasPassword: true };
    expect(redactValue({ usage, token: null })).toEqual({
      value: { usage, token: null },
      redacted: [],
    });
  });

  it('escapes member names in the pointers it reports', () => {
    expect(redactValue({ 'a/b': { 'x~token': 'abc' } }).redacted).toEqual([
      { pointer: '/a~1b/x~0token', why: 'key' },
    ]);
  });

  it('reads the value as JSON first', () => {
    expect(
      redactValue({
        at: new Date(Date.UTC(2026, 9, 9)),
        gone: undefined,
        n: Number.NaN,
      }).value,
    ).toEqual({ at: '2026-10-09T00:00:00.000Z', n: null });
    expect(redactValue(undefined)).toEqual({
      value: undefined,
      redacted: [],
    });
  });

  it('never withholds the same value twice differently', () => {
    const random = seeded(7);
    for (let i = 0; i < 300; i++) {
      const value = randomJson(random);
      const once = redactValue(value);
      expect(redactValue(once.value).value).toEqual(once.value);
    }
  });
});

describe('boundRecorded', () => {
  const limits = { maxString: 5, maxItems: 2, maxDepth: 2, ceiling: 1000 };

  it('cuts without writing into the value, listing every cut', () => {
    expect(
      boundRecorded(
        { s: 'abcdefgh', list: [1, 2, 3], deep: { a: { b: [1] } } },
        limits,
      ),
    ).toEqual({
      value: { s: 'abcde', list: [1, 2], deep: { a: { b: null } } },
      elided: [
        { pointer: '/s', kind: 'string', dropped: 3 },
        { pointer: '/list', kind: 'items', dropped: 1 },
        { pointer: '/deep/a/b', kind: 'depth', dropped: 3 },
      ],
    });
  });

  it('keeps keys in the order they were written', () => {
    expect(
      Object.keys(boundRecorded({ b: 1, a: 2 }, limits).value ?? {}),
    ).toEqual(['b', 'a']);
  });

  it('keeps nothing of a value still past the ceiling', () => {
    const big = { a: 'x'.repeat(5), b: 'y'.repeat(5) };
    expect(boundRecorded(big, { ...limits, ceiling: 10 })).toEqual({
      value: null,
      elided: [
        {
          pointer: '',
          kind: 'whole',
          dropped: JSON.stringify(big).length,
        },
      ],
    });
  });

  it('keeps what boundJson keeps, minus its markers', () => {
    const random = seeded(11);
    const tight = { maxString: 8, maxItems: 3, maxDepth: 3 };
    for (let i = 0; i < 300; i++) {
      const value = JSON.parse(JSON.stringify(randomJson(random)) ?? 'null');
      const { value: quiet, elided } = boundRecorded(value, {
        ...tight,
        ceiling: Number.POSITIVE_INFINITY,
      });
      const marked = JSON.stringify(boundJson(value, tight));
      if (elided.length === 0) expect(JSON.stringify(quiet)).toBe(marked);
      expect(JSON.stringify(quiet)).not.toContain('…(+');
    }
  });
});

describe('recordValue', () => {
  it('summarizes, shapes and hashes the whole withheld value', () => {
    const value = {
      id: 7,
      items: Array.from({ length: 80 }, (_, i) => ({ n: i })),
      apiKey: 'sk-should-never-be-stored',
    };
    const record = recordValue(value, 'node', unlimitedBudget());
    const withheld = { ...value, apiKey: null };
    expect(record.summary).toMatchObject({ kind: 'object', keys: 3 });
    expect(record.bytes).toBe(JSON.stringify(withheld).length);
    expect(record.hash).toBe(valueHash(withheld));
    expect(record.shape.properties?.items).toMatchObject({ type: 'array' });
    expect(record.redacted).toEqual([{ pointer: '/apiKey', why: 'key' }]);
    expect(record.elided).toEqual([
      { pointer: '/items', kind: 'items', dropped: 30 },
    ]);
    expect(JSON.stringify(record)).not.toContain('sk-should');
  });

  it('records the step tier tighter than the node tier', () => {
    const text = 'z'.repeat(2000);
    expect(recordValue(text, 'node', unlimitedBudget()).value).toBe(text);
    expect(recordValue(text, 'unit', unlimitedBudget()).value).toBe(
      'z'.repeat(RECORD_LIMITS.unit.maxString),
    );
  });

  it('spends the run budget and keeps the account once it is spent', () => {
    const budget = recordBudget(RECORD_RUN_BUDGET - 10);
    const first = recordValue('abc', 'node', budget);
    expect(first.value).toBe('abc');
    expect(budget.left).toBe(5);
    const second = recordValue('a longer value', 'node', budget);
    expect(second.value).toBeUndefined();
    expect(second.summary).toMatchObject({ kind: 'string', length: 14 });
    expect(second.hash).toBe(valueHash('a longer value'));
    expect(budget.left).toBe(5);
  });

  it('answers a budget that never goes below nothing', () => {
    expect(recordBudget(RECORD_RUN_BUDGET * 2).left).toBe(0);
  });

  it('records an absent value as such', () => {
    expect(recordValue(undefined, 'node', unlimitedBudget())).toEqual({
      summary: { kind: 'undefined' },
      shape: {},
      bytes: 0,
      hash: null,
    });
  });
});
