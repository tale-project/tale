import { describe, expect, it } from 'vitest';

import {
  flattenValue,
  markOf,
  valueAt,
  type ValueNodeRow,
  type ValueTreeRow,
} from './model';

const ISSUE = {
  title: 'Fix login',
  labels: ['bug', 'ui'],
  author: { name: 'Ada', id: 7 },
  score: null,
};

function ids(rows: readonly ValueTreeRow[]): string[] {
  return rows.map((row) => row.id);
}

function node(rows: readonly ValueTreeRow[], id: string): ValueNodeRow {
  const row = rows.find((each) => each.id === id);
  if (row?.type !== 'node') throw new Error(`no node row ${id}`);
  return row;
}

describe('flattenValue', () => {
  it('shows the top level of a container with its containers closed', () => {
    const rows = flattenValue(ISSUE);
    expect(ids(rows)).toEqual(['/title', '/labels', '/author', '/score']);
    expect(rows.map((row) => [row.level, row.posinset, row.setsize])).toEqual([
      [1, 1, 4],
      [1, 2, 4],
      [1, 3, 4],
      [1, 4, 4],
    ]);
    expect(node(rows, '/labels')).toMatchObject({
      container: true,
      expanded: false,
      childCount: 2,
      kind: 'array',
      key: 'labels',
      parentId: null,
    });
    expect(node(rows, '/score')).toMatchObject({
      container: false,
      kind: 'null',
    });
  });

  it('opens every level above defaultExpandDepth', () => {
    const rows = flattenValue(ISSUE, { defaultExpandDepth: 2 });
    expect(ids(rows)).toEqual([
      '/title',
      '/labels',
      '/labels/0',
      '/labels/1',
      '/author',
      '/author/name',
      '/author/id',
      '/score',
    ]);
    expect(node(rows, '/labels/1')).toMatchObject({
      level: 2,
      posinset: 2,
      setsize: 2,
      key: 1,
      parentId: '/labels',
    });
  });

  it("follows the reader's opened and closed containers over the default", () => {
    const rows = flattenValue(ISSUE, {
      defaultExpandDepth: 2,
      expanded: new Map([
        ['/labels', false],
        ['/author', true],
      ]),
    });
    expect(ids(rows)).toEqual([
      '/title',
      '/labels',
      '/author',
      '/author/name',
      '/author/id',
      '/score',
    ]);
  });

  it('shows a value that is not a container as one row without a key', () => {
    for (const value of ['text', 42, true, null, undefined, [], {}]) {
      const rows = flattenValue(value);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        type: 'node',
        id: '',
        key: null,
        level: 1,
        posinset: 1,
        setsize: 1,
        container: false,
      });
    }
  });

  it('pages long containers and says how many the next page shows', () => {
    const list = Array.from({ length: 120 }, (_, index) => index);
    const rows = flattenValue(list, { pageSize: 50 });
    expect(rows).toHaveLength(51);
    expect(rows[50]).toMatchObject({
      type: 'more',
      containerPointer: '',
      shown: 50,
      total: 120,
      next: 50,
      posinset: 51,
      setsize: 120,
    });
    const more = flattenValue(list, {
      pageSize: 50,
      shown: new Map([['', 100]]),
    });
    expect(more.at(-1)).toMatchObject({ type: 'more', shown: 100, next: 20 });
    expect(
      flattenValue(list, { pageSize: 50, shown: new Map([['', 120]]) }),
    ).toHaveLength(120);
  });

  it('opens and pages up to every mark and the selection', () => {
    const value = {
      items: Array.from({ length: 80 }, (_, index) => ({ id: index })),
    };
    const rows = flattenValue(value, {
      pageSize: 10,
      marks: new Map([['/items/64/id', 'changed']]),
    });
    expect(node(rows, '/items').expanded).toBe(true);
    expect(node(rows, '/items/64').expanded).toBe(true);
    expect(node(rows, '/items/64/id').mark).toEqual({ kind: 'changed' });
    // The page reaches the marked item; the rest stays behind "Show more".
    expect(rows.findLast((row) => row.parentId === '/items')).toMatchObject({
      type: 'more',
      shown: 65,
      next: 10,
    });
    const selected = flattenValue(value, {
      pageSize: 10,
      selectedPointer: '/items/3',
    });
    expect(node(selected, '/items').expanded).toBe(true);
    expect(node(selected, '/items/3').expanded).toBe(false);
  });

  it('adds a ghost row for a key a missing mark names', () => {
    const rows = flattenValue(
      { triage: { summary: 'ok', labels: [] } },
      { marks: new Map([['/triage/amount', 'missing']]) },
    );
    expect(ids(rows)).toEqual([
      '/triage',
      '/triage/summary',
      '/triage/labels',
      '/triage/amount\u0000missing',
    ]);
    expect(rows[3]).toMatchObject({
      type: 'missing',
      key: 'amount',
      pointer: '/triage/amount',
      level: 2,
      posinset: 3,
      setsize: 3,
      parentId: '/triage',
    });
    // A key that is there needs no ghost.
    const present = flattenValue(
      { a: 1 },
      { marks: new Map([['/a', 'missing']]) },
    );
    expect(ids(present)).toEqual(['/a']);
  });

  it('hands each row the cuts and secrets at its pointer', () => {
    const rows = flattenValue(
      { body: 'Long text', items: [1, 2], token: null },
      {
        elided: [
          { pointer: '/body', kind: 'string', dropped: 3412 },
          { pointer: '/items', kind: 'items', dropped: 150 },
        ],
        redacted: ['/token'],
      },
    );
    expect(node(rows, '/body').elided).toEqual([
      { pointer: '/body', kind: 'string', dropped: 3412 },
    ]);
    expect(node(rows, '/items').elided).toHaveLength(1);
    expect(node(rows, '/token').redacted).toBe(true);
    expect(node(rows, '/body').redacted).toBe(false);
  });

  it('reads keys that hold "/" and "~" through escaped pointers', () => {
    const rows = flattenValue(
      { 'a/b': { 'c~d': 1 } },
      { defaultExpandDepth: 2 },
    );
    expect(ids(rows)).toEqual(['/a~1b', '/a~1b/c~0d']);
    expect(node(rows, '/a~1b/c~0d').path).toEqual(['a/b', 'c~d']);
  });

  it('shows a value that holds itself as a closed row instead of looping', () => {
    const loop: Record<string, unknown> = { name: 'loop' };
    loop.self = loop;
    const rows = flattenValue(loop, { defaultExpandDepth: 5 });
    expect(ids(rows)).toEqual(['/name', '/self']);
    expect(node(rows, '/self')).toMatchObject({
      container: false,
      expanded: false,
    });
  });
});

describe('markOf', () => {
  it('reads a bare kind and a mark with its earlier value alike', () => {
    expect(markOf('added')).toEqual({ kind: 'added' });
    expect(markOf({ kind: 'changed', before: 250 })).toEqual({
      kind: 'changed',
      before: 250,
    });
    expect(markOf(undefined)).toBeUndefined();
  });
});

describe('valueAt', () => {
  it('walks lists and objects, and answers undefined past the value', () => {
    expect(valueAt(ISSUE, ['author', 'name'])).toBe('Ada');
    expect(valueAt(ISSUE, ['labels', 1])).toBe('ui');
    expect(valueAt(ISSUE, ['labels', 'length'])).toBeUndefined();
    expect(valueAt(ISSUE, ['title', 'x'])).toBeUndefined();
    expect(valueAt({ ['__proto__']: 1 }, ['constructor'])).toBeUndefined();
  });
});
