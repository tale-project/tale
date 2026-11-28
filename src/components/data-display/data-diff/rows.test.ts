import { describe, expect, it } from 'vitest';

import { diffValues } from '../../../data/value-diff';
import {
  orderChanges,
  shapeKeysAt,
  sharesStructure,
  unchangedFields,
  valueKeysAt,
} from './rows';

describe('orderChanges', () => {
  it('lists changes in the order the value is written, not by key name', () => {
    const before = { zeta: 1, alpha: 'a', mid: [1, 2, 3], gone: true };
    const after = { zeta: 2, alpha: 'b', mid: [1, 9, 3, 4] };
    const { changes } = diffValues(before, after);
    expect(
      orderChanges(changes, valueKeysAt(before, after)).map(
        (change) => change.pointer,
      ),
    ).toEqual(['/zeta', '/alpha', '/mid/1', '/mid/3', '/gone']);
  });

  it('puts a container before the changes inside it', () => {
    const before = { items: [{ id: 1 }, { id: 2 }] };
    const after = { items: [{ id: 2, x: 1 }, { id: 1 }] };
    const { changes } = diffValues(before, after);
    const ordered = orderChanges(changes, valueKeysAt(before, after));
    expect(ordered.map((change) => [change.kind, change.pointer])).toEqual([
      ['reordered', '/items'],
      ['added', '/items/0/x'],
    ]);
  });

  it("orders a shape diff by the shapes' fields, list items stepped into", () => {
    const keysAt = shapeKeysAt(
      {
        properties: {
          count: {},
          items: { items: { properties: { name: {}, id: {} } } },
        },
      },
      {
        properties: {
          items: { items: { properties: { id: {}, size: {} } } },
          total: {},
        },
      },
    );
    expect(keysAt([])).toEqual(['items', 'total', 'count', 'items']);
    expect(keysAt(['items', 0])).toEqual(['id', 'size', 'name', 'id']);
    expect(keysAt(['nothing'])).toEqual([]);
  });
});

describe('unchangedFields', () => {
  it('folds an unchanged subtree into one entry and walks only into changes', () => {
    const before = { a: 1, b: { c: 1, d: 2 }, e: { f: [1, 2] } };
    const after = { a: 1, b: { c: 1, d: 3 }, e: { f: [1, 2] } };
    const { changes } = diffValues(before, after);
    const { fields, total } = unchangedFields(after, changes);
    expect(fields.map((field) => field.path)).toEqual([
      ['a'],
      ['b', 'c'],
      ['e'],
    ]);
    expect(total).toBe(3);
  });

  it('lists the items of a list whose only change is their order', () => {
    const before = { items: [{ id: 1 }, { id: 2 }] };
    const after = { items: [{ id: 2 }, { id: 1 }] };
    const { changes } = diffValues(before, after);
    expect(
      unchangedFields(after, changes).fields.map((field) => field.path),
    ).toEqual([
      ['items', 0],
      ['items', 1],
    ]);
  });

  it('keeps at most `limit` entries and counts them all', () => {
    const after = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`k${index}`, index]),
    );
    const before = { ...after, k0: -1 };
    const { changes } = diffValues(before, after);
    const result = unchangedFields(after, changes, 5);
    expect(result.fields).toHaveLength(5);
    expect(result.total).toBe(19);
  });

  it('lists nothing for a value with no change', () => {
    expect(unchangedFields({ a: 1 }, [])).toEqual({ fields: [], total: 0 });
  });
});

describe('sharesStructure', () => {
  it.each([
    [{ a: 1, b: 2 }, { b: 3, c: 4 }, true],
    [{ a: 1 }, { b: 2 }, false],
    [[1], [2, 3], true],
    [{ a: 1 }, [1], false],
    [{ a: 1 }, 'text', false],
    ['250', 250, true],
    [null, { a: 1 }, true],
    [undefined, [1], true],
    [{}, { a: 1 }, true],
  ])('%j and %j: %s', (before, after, expected) => {
    expect(sharesStructure(before, after)).toBe(expected);
  });
});
