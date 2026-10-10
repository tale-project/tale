// @vitest-environment node

import {
  mutate,
  randomJson,
  seeded,
  type Random,
} from '@tale/ui/data/random-json';
import { describe, expect, it } from 'vitest';

import { stableStringify } from '../../shared/utils/stable-stringify';
import {
  compareExact,
  compareIncludes,
  mismatchesOf,
  reportChange,
  reportValue,
} from './expect';

/** `value` with a few members set to `undefined` — what a template that
 * reads a missing field leaves in a run's output. */
function withHoles(random: Random, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => withHoles(random, v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = random() < 0.15 ? undefined : withHoles(random, entry);
    }
    if (random() < 0.1) out.extra = undefined;
    return out;
  }
  return value;
}

describe('compareExact', () => {
  it('finds no difference exactly when the old pass rule finds the two equal (2 000 cases)', () => {
    const random = seeded(20_261_009);
    let equal = 0;
    for (let i = 0; i < 2000; i++) {
      const a = withHoles(random, randomJson(random, 4));
      const roll = random();
      const b =
        roll < 0.3
          ? structuredClone(a)
          : roll < 0.45
            ? withHoles(random, a)
            : withHoles(
                random,
                mutate(random, a, 1 + Math.floor(random() * 3)),
              );
      const same = stableStringify(a) === stableStringify(b);
      if (same) equal++;
      expect(compareExact(a, b).length === 0, JSON.stringify([a, b])).toBe(
        same,
      );
    }
    // Both sides of the property were exercised.
    expect(equal).toBeGreaterThan(400);
    expect(equal).toBeLessThan(1600);
  });

  it('reads a member holding undefined as null, as the pass rule always has', () => {
    expect(compareExact({ a: null }, { a: undefined })).toEqual([]);
    expect(compareExact({}, { a: undefined })).toEqual([
      {
        pointer: '/a',
        path: ['a'],
        kind: 'added',
        after: null,
        afterKind: 'null',
      },
    ]);
  });

  it('keeps the pass rule for a member named like what every object inherits', () => {
    // A run's output is read back through JSON.parse, which keeps a member
    // named __proto__ as a member of its own.
    const withProto = JSON.parse('{"a": 1, "__proto__": {}}') as unknown;
    expect(stableStringify(withProto)).not.toBe(stableStringify({ a: 1 }));
    expect(compareExact({ a: 1 }, withProto)).not.toEqual([]);
    expect(compareExact(withProto, { a: 1 })).not.toEqual([]);
    expect(
      compareExact({}, JSON.parse('{"__proto__": {}}') as unknown),
    ).not.toEqual([]);
    expect(
      compareExact(withProto, JSON.parse('{"a": 1, "__proto__": {}}')),
    ).toEqual([]);
    expect(mismatchesOf('exact', { a: 1 }, withProto).total).toBeGreaterThan(0);
  });

  it('names what the test expected and the run lacks, and what it has besides', () => {
    expect(
      compareExact(
        { total: 3, items: ['a', 'b'], status: 'open' },
        { total: '3', items: ['a'], owner: 'Ada', status: 'open' },
      ),
    ).toEqual([
      {
        pointer: '/items/1',
        path: ['items', 1],
        kind: 'removed',
        before: 'b',
        beforeKind: 'string',
      },
      {
        pointer: '/owner',
        path: ['owner'],
        kind: 'added',
        after: 'Ada',
        afterKind: 'string',
      },
      {
        pointer: '/total',
        path: ['total'],
        kind: 'type-changed',
        before: 3,
        after: '3',
        beforeKind: 'number',
        afterKind: 'string',
      },
    ]);
  });

  it('pairs list items by position, never by an id', () => {
    const moved = compareExact([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }]);
    expect(moved.map((c) => [c.pointer, c.kind])).toEqual([
      ['/0/id', 'changed'],
      ['/1/id', 'changed'],
    ]);
  });

  it('lists at most its cap and counts every difference', () => {
    const expected = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`k${i}`, i]),
    );
    const actual = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`k${i}`, -i - 1]),
    );
    expect(compareExact(expected, actual)).toHaveLength(20);
    expect(mismatchesOf('exact', expected, actual, 5)).toMatchObject({
      total: 30,
    });
    expect(mismatchesOf('exact', expected, actual, 5).changes).toHaveLength(5);
  });
});

describe('compareIncludes', () => {
  it('checks only the keys the expectation lists, recursively', () => {
    expect(
      compareIncludes(
        { read: 0, inbox: { open: true } },
        { read: 0, needsReply: [], inbox: { open: true, size: 4 } },
      ),
    ).toEqual([]);
    expect(
      compareIncludes({ read: 0, drafted: [] }, { read: 2 }).map((c) => [
        c.pointer,
        c.kind,
      ]),
    ).toEqual([
      ['/drafted', 'removed'],
      ['/read', 'changed'],
    ]);
  });

  it('compares lists item by item, and they must be as long', () => {
    expect(
      compareIncludes([{ id: 1 }, { id: 2 }], [{ id: 1, x: 1 }, { id: 2 }]),
    ).toEqual([]);
    expect(
      compareIncludes([{ id: 1 }], [{ id: 1 }, { id: 2 }]).map((c) => [
        c.pointer,
        c.kind,
      ]),
    ).toEqual([['', 'changed']]);
  });

  it('an expected null matches a member a template left undefined', () => {
    expect(compareIncludes({ summary: null }, { summary: undefined })).toEqual(
      [],
    );
  });
});

describe('reportValue', () => {
  it('quotes a value whole when it is short', () => {
    expect(reportValue({ b: 1, a: [true, null] })).toEqual({
      a: [true, null],
      b: 1,
    });
    expect(reportValue(undefined)).toBeNull();
    expect(reportValue(7)).toBe(7);
  });

  it('cuts long text, and the JSON of a long value, to 200 characters', () => {
    const text = reportValue('x'.repeat(500));
    expect(text).toBe(`${'x'.repeat(200)}…`);
    const big = reportValue({ rows: Array.from({ length: 100 }, (_, i) => i) });
    if (typeof big !== 'string') throw new Error('expected cut text');
    expect(big).toHaveLength(201);
    expect(big.startsWith('{"rows":[0,1,2')).toBe(true);
    // A character that takes two units is never split in half.
    expect(reportValue(`${'a'.repeat(199)}😀tail`)).toBe(`${'a'.repeat(199)}…`);
  });

  it('makes every string storable', () => {
    expect(reportValue('a\u0000b')).toBe('a�b');
    expect(reportValue({ 'k\u0000': '\ud800' })).toEqual({ 'k�': '�' });
  });

  it('quotes both sides of a change', () => {
    expect(
      reportChange({
        pointer: '/body',
        path: ['body'],
        kind: 'changed',
        before: 'y'.repeat(300),
        after: 'short',
        beforeKind: 'string',
        afterKind: 'string',
      }),
    ).toEqual({
      pointer: '/body',
      path: ['body'],
      kind: 'changed',
      before: `${'y'.repeat(200)}…`,
      after: 'short',
      beforeKind: 'string',
      afterKind: 'string',
    });
  });
});
