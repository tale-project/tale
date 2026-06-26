import { describe, expect, it, vi } from 'vitest';

import { collectFilteredPage, type SourcePage } from './filtered_pagination';

/** A fake source backed by an array of pages; page is 1-indexed. */
function source(pages: SourcePage[]) {
  const fetchSourcePage = vi.fn(
    async (page: number): Promise<SourcePage> =>
      pages[page - 1] ?? { rows: [], hasNext: false },
  );
  return { fetchSourcePage };
}

const issues = (...nums: number[]) => nums.map((number) => ({ number }));
const base = {
  excluded: new Set<string>(),
  rowKeyTemplate: 'r#{number}',
  perPage: 5,
  pageBudget: 10,
};

describe('collectFilteredPage', () => {
  it('fills a full page from one source page and yields a mid-page cursor', async () => {
    const { fetchSourcePage } = source([
      { rows: issues(1, 2, 3, 4), hasNext: true },
    ]);

    const out = await collectFilteredPage({
      ...base,
      perPage: 2,
      fetchSourcePage,
    });

    expect(out.data).toEqual(issues(1, 2));
    expect(out.pagination).toEqual({
      hasNextPage: true,
      nextCursor: { sourcePage: 1, sourceOffset: 2 },
    });
    expect(fetchSourcePage).toHaveBeenCalledTimes(1);
  });

  it('accumulates across source pages until perPage visible rows are collected', async () => {
    const { fetchSourcePage } = source([
      { rows: issues(1, 2), hasNext: true },
      { rows: issues(3, 4), hasNext: true },
    ]);

    const out = await collectFilteredPage({
      ...base,
      perPage: 3,
      fetchSourcePage,
    });

    expect(out.data).toEqual(issues(1, 2, 3));
    expect(out.pagination.nextCursor).toEqual({
      sourcePage: 2,
      sourceOffset: 1,
    });
    expect(fetchSourcePage).toHaveBeenCalledTimes(2);
  });

  it('drops rows failing rowWhen (e.g. pull requests)', async () => {
    const { fetchSourcePage } = source([
      {
        rows: [{ number: 1, pull_request: {} }, { number: 2 }, { number: 3 }],
        hasNext: false,
      },
    ]);

    const out = await collectFilteredPage({
      ...base,
      rowWhen: '!pull_request',
      fetchSourcePage,
    });

    expect(out.data).toEqual(issues(2, 3));
    expect(out.pagination).toEqual({ hasNextPage: false, nextCursor: null });
  });

  it('drops rows whose key is in the exclusion set', async () => {
    const { fetchSourcePage } = source([
      { rows: issues(1, 2, 3), hasNext: false },
    ]);

    const out = await collectFilteredPage({
      ...base,
      excluded: new Set(['r#2']),
      fetchSourcePage,
    });

    expect(out.data).toEqual(issues(1, 3));
    expect(out.pagination.nextCursor).toBeNull();
  });

  it('returns nextCursor null when the source is exhausted before the page fills', async () => {
    const { fetchSourcePage } = source([
      { rows: issues(1, 2), hasNext: false },
    ]);

    const out = await collectFilteredPage({ ...base, fetchSourcePage });

    expect(out.data).toEqual(issues(1, 2));
    expect(out.pagination).toEqual({ hasNextPage: false, nextCursor: null });
  });

  it('stops at the page budget with a resume cursor when nothing visible yet', async () => {
    // Every row is excluded and the source always reports more pages; the budget
    // (3) — NOT a count of visible rows — bounds the single call.
    const pages: SourcePage[] = Array.from({ length: 20 }, (_, i) => ({
      rows: issues(i + 1),
      hasNext: true,
    }));
    const { fetchSourcePage } = source(pages);

    const out = await collectFilteredPage({
      ...base,
      excluded: new Set(pages.map((_, i) => `r#${i + 1}`)),
      pageBudget: 3,
      fetchSourcePage,
    });

    expect(out.data).toEqual([]);
    expect(out.pagination).toEqual({
      hasNextPage: true,
      nextCursor: { sourcePage: 4, sourceOffset: 0 },
    });
    expect(fetchSourcePage).toHaveBeenCalledTimes(3);
  });

  it('resumes from a given cursor, skipping already-emitted rows', async () => {
    const { fetchSourcePage } = source([
      { rows: issues(1, 2, 3, 4), hasNext: false },
    ]);

    const out = await collectFilteredPage({
      ...base,
      cursor: { sourcePage: 1, sourceOffset: 2 },
      fetchSourcePage,
    });

    expect(out.data).toEqual(issues(3, 4));
    expect(out.pagination.nextCursor).toBeNull();
  });

  it('skips non-record rows', async () => {
    const { fetchSourcePage } = source([
      { rows: [{ number: 1 }, 'nope', null, { number: 2 }], hasNext: false },
    ]);

    const out = await collectFilteredPage({ ...base, fetchSourcePage });

    expect(out.data).toEqual(issues(1, 2));
  });
});
