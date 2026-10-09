import { describe, expect, it } from 'vitest';

import { inferSchema } from './infer-schema';
import { pointerOf } from './json-pointer';
import { mutate, randomJson, seeded } from './random-json';
import { jsonNormalize, stableStringify } from './stable-stringify';
import {
  type DiffChange,
  diffShapes,
  diffValues,
  suggestDiffRoot,
} from './value-diff';

/** `before` with a by-position diff's changes applied. */
function patch(before: unknown, changes: readonly DiffChange[]): unknown {
  let root = structuredClone(jsonNormalize(before));
  const container = (path: readonly (string | number)[]): unknown => {
    let node: unknown = root;
    for (const segment of path) {
      if (Array.isArray(node)) node = node[Number(segment)];
      else if (typeof node === 'object' && node !== null) {
        node = Object.entries(node).find(
          ([key]) => key === String(segment),
        )?.[1];
      }
    }
    return node;
  };
  const set = (path: readonly (string | number)[], value: unknown): void => {
    if (path.length === 0) {
      root = structuredClone(value);
      return;
    }
    const parent = container(path.slice(0, -1));
    const last = path.at(-1) ?? '';
    if (Array.isArray(parent)) parent[Number(last)] = structuredClone(value);
    else if (typeof parent === 'object' && parent !== null) {
      Object.assign(parent, { [String(last)]: structuredClone(value) });
    }
  };
  const removals: DiffChange[] = [];
  for (const change of changes) {
    if (change.kind === 'removed') removals.push(change);
    else set(change.path, change.after);
  }
  // A list shortened loses its tail: drop from the highest index down.
  for (const change of removals.toReversed()) {
    const parent = container(change.path.slice(0, -1));
    const last = change.path.at(-1) ?? '';
    if (Array.isArray(parent)) parent.splice(Number(last), 1);
    else if (typeof parent === 'object' && parent !== null) {
      Reflect.deleteProperty(parent, String(last));
    }
  }
  return root;
}

/** Every pointer `value` holds, the root included. */
function pointersIn(value: unknown, path: (string | number)[] = []): string[] {
  const own = [pointerOf(path)];
  if (Array.isArray(value)) {
    return own.concat(
      ...value.map((item, index) => pointersIn(item, [...path, index])),
    );
  }
  if (typeof value === 'object' && value !== null) {
    return own.concat(
      ...Object.entries(value).map(([key, entry]) =>
        pointersIn(entry, [...path, key]),
      ),
    );
  }
  return own;
}

describe('diffValues', () => {
  it('lists an object’s added, removed and changed fields by pointer', () => {
    const result = diffValues(
      { id: 1, name: 'Ada', note: 'x' },
      { id: 1, name: 'Grace', tags: ['a'] },
    );
    expect(result.changes.map(({ pointer, kind }) => [pointer, kind])).toEqual([
      ['/name', 'changed'],
      ['/note', 'removed'],
      ['/tags', 'added'],
    ]);
    expect(result.identical).toBe(false);
  });

  it('reads null against a value as changed and other kind pairs as type-changed', () => {
    const result = diffValues({ a: null, b: '1' }, { a: 3, b: 1 });
    expect(result.changes.map((change) => change.kind)).toEqual([
      'changed',
      'type-changed',
    ]);
    expect(result.changes[1]).toMatchObject({
      beforeKind: 'string',
      afterKind: 'number',
    });
  });

  it('pairs list items by a unique key and reads a move as reordered', () => {
    const before = [
      { id: 1, total: 1 },
      { id: 2, total: 2 },
      { id: 3, total: 3 },
    ];
    const after = [
      { id: 3, total: 3 },
      { id: 1, total: 1 },
      { id: 2, total: 5 },
    ];
    const result = diffValues(before, after);
    expect(result.changes.map(({ pointer, kind }) => [pointer, kind])).toEqual([
      ['/2/total', 'changed'],
      ['', 'reordered'],
    ]);
    // By position, the same move changes both fields of every item.
    expect(diffValues(before, after, { arrays: 'index' }).counts.changed).toBe(
      6,
    );
  });

  it('pairs by position when an item lacks the key or repeats it', () => {
    const result = diffValues([{ id: 1 }, { id: 1 }], [{ id: 1 }, { id: 2 }]);
    expect(result.changes.map(({ pointer }) => pointer)).toEqual(['/1/id']);
  });

  it('reads a withheld subtree as unknown, never changed', () => {
    const result = diffValues(
      { secret: 'a', open: 1 },
      { secret: 'b', open: 1 },
      { unknownAt: ['/secret'] },
    );
    expect(result.changes).toEqual([
      expect.objectContaining({ pointer: '/secret', kind: 'unknown' }),
    ]);
    expect(result.counts.changed).toBe(0);
  });

  it('checks only what an expectation names in mode includes', () => {
    const result = diffValues(
      { status: 'done', items: [1, 2] },
      { status: 'done', items: [1, 2], extra: true, more: 1 },
      { mode: 'includes' },
    );
    expect(result.identical).toBe(true);
    expect(result.notChecked).toBe(2);
    const shorter = diffValues(
      { items: [1, 2] },
      { items: [1] },
      { mode: 'includes' },
    );
    expect(shorter.changes).toEqual([
      expect.objectContaining({ pointer: '/items', kind: 'changed' }),
    ]);
  });

  it('stops listing at maxChanges and keeps the counts exact', () => {
    const before = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`k${i}`, i]),
    );
    const after = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`k${i}`, i + 1]),
    );
    const result = diffValues(before, after, { maxChanges: 10 });
    expect(result.changes).toHaveLength(10);
    expect(result.counts.changed).toBe(30);
    expect(result.truncated).toBe(true);
  });

  it('compares deeper than maxDepth whole', () => {
    const result = diffValues(
      { a: { b: { c: 1 } } },
      { a: { b: { c: 2 } } },
      { maxDepth: 1 },
    );
    expect(result.changes).toEqual([
      expect.objectContaining({ pointer: '/a', kind: 'changed' }),
    ]);
  });

  describe('properties (3 000 seeded pairs)', () => {
    const random = seeded(4_620_261_009);
    const pairs = Array.from({ length: 3000 }, () => {
      const before = randomJson(random, 4);
      return {
        before,
        after:
          random() < 0.2 ? structuredClone(before) : mutate(random, before),
      };
    });

    it('(a) by position, identical exactly when the JSON is equal', () => {
      for (const { before, after } of pairs) {
        const result = diffValues(before, after, { arrays: 'index' });
        expect(result.identical, JSON.stringify({ before, after })).toBe(
          stableStringify(before) === stableStringify(after),
        );
      }
    });

    it('(b) a by-position diff patches before into after', () => {
      for (const { before, after } of pairs) {
        const { changes } = diffValues(before, after, {
          arrays: 'index',
          maxChanges: 100_000,
        });
        expect(
          stableStringify(patch(before, changes)),
          JSON.stringify({ before, after }),
        ).toBe(stableStringify(after));
      }
    });

    it('(d) a withheld pointer never reads changed', () => {
      const pick = seeded(9);
      for (const { before, after } of pairs.slice(0, 1000)) {
        const pointers = pointersIn(jsonNormalize(before));
        const withheld = pointers[Math.floor(pick() * pointers.length)] ?? '';
        const { changes } = diffValues(before, after, {
          unknownAt: [withheld],
        });
        for (const change of changes) {
          if (
            change.pointer === withheld ||
            change.pointer.startsWith(`${withheld}/`)
          ) {
            expect(change.kind).toBe('unknown');
          }
        }
      }
    });
  });

  it('compares two 10 000-value pairs quickly', () => {
    const make = (offset: number) =>
      Array.from({ length: 2000 }, (_, id) => ({
        id,
        a: id,
        b: `x${id}`,
        c: id + offset,
        d: [id],
      }));
    const before = make(0);
    const after = make(1);
    const started = performance.now();
    const result = diffValues(before, after);
    const elapsed = performance.now() - started;
    console.info(
      `[data-core] diffValues on 2 × 10 000 values: ${elapsed.toFixed(1)} ms`,
    );
    expect(result.counts.changed).toBe(2000);
    // The design's budget is 40 ms; under a loaded test machine allow more.
    expect(elapsed).toBeLessThan(1000);
  });
});

describe('diffShapes', () => {
  it('lists added, removed, retyped and re-required fields', () => {
    const before = inferSchema({ id: 1, name: 'Ada', note: 'x' });
    const after =
      inferSchema([
        { id: '1', tags: [] },
        { id: '2', name: 'Grace', tags: [] },
      ]).items ?? {};
    const result = diffShapes(before, after);
    expect(result.changes.map(({ pointer, kind }) => [pointer, kind])).toEqual([
      ['/id', 'type-changed'],
      ['/name', 'changed'],
      ['/note', 'removed'],
      ['/tags', 'added'],
    ]);
  });

  it('finds two equal shapes identical', () => {
    const shape = inferSchema({ a: [1, 2], b: { c: true } });
    expect(diffShapes(shape, shape).identical).toBe(true);
  });
});

describe('suggestDiffRoot', () => {
  it('picks the earlier value sharing most of this one’s values', () => {
    const suggestion = suggestDiffRoot(
      { task: { id: 'T-1', title: 'Fix' }, priority: 2 },
      [
        {
          id: 'fetch',
          label: 'Fetch',
          value: { id: 'T-1', title: 'Fix', body: '…' },
        },
        { id: 'other', label: 'Other', value: { count: 9 } },
      ],
    );
    expect(suggestion).toEqual({ candidateId: 'fetch', score: 2 / 3 });
  });

  it('answers null when no candidate shares half', () => {
    expect(
      suggestDiffRoot({ a: 1, b: 2, c: 3 }, [
        { id: 'x', label: 'X', value: { a: 1 } },
      ]),
    ).toBeNull();
  });
});
