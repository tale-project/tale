import { describe, expect, it } from 'vitest';

import { paginateWithFilter } from './helpers';
import type { CursorPaginatedResult } from './types';

// Structurally a GenericDocument (Record<string, Value>); _creationTime keeps
// it shaped like a real Convex row. A `type` alias (not `interface`) so it
// carries the implicit index signature GenericDocument requires.
type Row = {
  _id: string;
  _creationTime: number;
  active: boolean;
};

function rows(n: number, isActive: (i: number) => boolean): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    _id: `doc_${String(i).padStart(3, '0')}`,
    _creationTime: i,
    active: isActive(i),
  }));
}

// paginateWithFilter consumes an AsyncIterable that yields the WHOLE ordered
// list; it skips to `cursor` internally. Generators are one-shot, so make a
// fresh one per page.
async function* gen(all: Row[]): AsyncGenerator<Row> {
  for (const r of all) yield r;
}

// Drive the paginator to exhaustion the way a real consumer does.
async function pageThrough(
  all: Row[],
  opts: {
    numItems: number;
    maxScanItems?: number;
    filter?: (r: Row) => boolean;
  },
): Promise<{ ids: string[]; pages: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  for (let guard = 0; guard < 1000; guard++) {
    pages++;
    const res: CursorPaginatedResult<Row> = await paginateWithFilter<Row>(
      gen(all),
      {
        numItems: opts.numItems,
        cursor,
        maxScanItems: opts.maxScanItems,
        filter: opts.filter,
      },
    );
    ids.push(...res.page.map((r) => r._id));
    if (res.isDone) break;
    // A non-done page MUST advance, or the consumer loops forever.
    expect(res.continueCursor).not.toBe('');
    cursor = res.continueCursor;
  }
  return { ids, pages };
}

describe('paginateWithFilter', () => {
  it('pages through a heavily-filtered list without falsely reporting isDone', async () => {
    // 50 rows, every 5th active (10 active). A small scan budget forces many
    // scan-cap breaks — the regression made these report isDone early and drop
    // the tail. The consumer must still see all 10 active ids, in order.
    const all = rows(50, (i) => i % 5 === 0);
    const active = all.filter((r) => r.active).map((r) => r._id);
    const { ids } = await pageThrough(all, {
      numItems: 3,
      maxScanItems: 12,
      filter: (r) => r.active,
    });
    expect(ids).toEqual(active);
    // no duplicates
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('terminates (no infinite loop) when every row is filtered out', async () => {
    const all = rows(20, () => false);
    const { ids, pages } = await pageThrough(all, {
      numItems: 3,
      maxScanItems: 5,
      filter: (r) => r.active,
    });
    expect(ids).toEqual([]);
    expect(pages).toBeLessThan(1000);
  });

  it('paginates a fully-active list normally', async () => {
    const all = rows(10, () => true);
    const { ids } = await pageThrough(all, { numItems: 3 });
    expect(ids).toEqual(all.map((r) => r._id));
  });

  it('returns isDone=true and the empty cursor for an empty source', async () => {
    const res = await paginateWithFilter<Row>(gen([]), {
      numItems: 5,
      cursor: null,
    });
    expect(res.page).toEqual([]);
    expect(res.isDone).toBe(true);
    expect(res.continueCursor).toBe('');
  });
});
