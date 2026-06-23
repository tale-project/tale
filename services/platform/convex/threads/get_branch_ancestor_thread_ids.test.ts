import { describe, expect, it } from 'vitest';

import type { QueryCtx } from '../_generated/server';
import { getBranchAncestorThreadIds } from './get_branch_ancestor_thread_ids';

interface BranchRow {
  branchThreadId: string;
  parentThreadId: string;
  forkOrderCreatedAt?: number;
}

/**
 * Mocks `ctx.db.query('threadBranches').withIndex('by_branchThreadId', q =>
 * q.eq('branchThreadId', X)).first()` against a fixed set of branch rows.
 */
function ctxWithBranches(rows: BranchRow[]): QueryCtx {
  const byBranch = new Map(rows.map((r) => [r.branchThreadId, r]));
  const db = {
    query: (_table: string) => ({
      withIndex: (
        _index: string,
        cb: (q: {
          eq: (field: string, value: string) => { __value: string };
        }) => { __value: string },
      ) => {
        const built = cb({ eq: (_f, value) => ({ __value: value }) });
        return {
          first: async () => byBranch.get(built.__value) ?? null,
        };
      },
    }),
  };
  return { db } as unknown as QueryCtx;
}

describe('getBranchAncestorThreadIds', () => {
  it('returns just the thread itself (no cut) for a root (never forked)', async () => {
    const ctx = ctxWithBranches([]);
    expect(await getBranchAncestorThreadIds(ctx, 'root')).toEqual([
      { threadId: 'root' },
    ]);
  });

  it('walks tip → parent → root, tip-first, carrying each fork cut', async () => {
    const ctx = ctxWithBranches([
      { branchThreadId: 'tip', parentThreadId: 'mid', forkOrderCreatedAt: 100 },
      {
        branchThreadId: 'mid',
        parentThreadId: 'root',
        forkOrderCreatedAt: 200,
      },
    ]);
    const chain = await getBranchAncestorThreadIds(ctx, 'tip');
    expect(chain[0]).toEqual({ threadId: 'tip' }); // active tip — no cut
    expect(chain).toEqual([
      { threadId: 'tip' },
      { threadId: 'mid', filesBefore: 100 },
      { threadId: 'root', filesBefore: 100 }, // tightest cut on the path
    ]);
  });

  it('tightens the cut to the minimum fork point down the chain', async () => {
    const ctx = ctxWithBranches([
      { branchThreadId: 'tip', parentThreadId: 'mid', forkOrderCreatedAt: 300 },
      { branchThreadId: 'mid', parentThreadId: 'root', forkOrderCreatedAt: 50 },
    ]);
    expect(await getBranchAncestorThreadIds(ctx, 'tip')).toEqual([
      { threadId: 'tip' },
      { threadId: 'mid', filesBefore: 300 },
      { threadId: 'root', filesBefore: 50 }, // min(300, 50)
    ]);
  });

  it('a legacy branch row without forkOrderCreatedAt yields no cut for that hop', async () => {
    const ctx = ctxWithBranches([
      { branchThreadId: 'tip', parentThreadId: 'root' }, // legacy: no fork ts
    ]);
    expect(await getBranchAncestorThreadIds(ctx, 'tip')).toEqual([
      { threadId: 'tip' },
      { threadId: 'root', filesBefore: undefined },
    ]);
  });

  it('stops on a self-referential cycle without looping', async () => {
    const ctx = ctxWithBranches([
      { branchThreadId: 'a', parentThreadId: 'b', forkOrderCreatedAt: 1 },
      { branchThreadId: 'b', parentThreadId: 'a', forkOrderCreatedAt: 2 },
    ]);
    // a → b, then b → a is already visited → stop. No infinite loop.
    expect(
      (await getBranchAncestorThreadIds(ctx, 'a')).map((h) => h.threadId),
    ).toEqual(['a', 'b']);
  });
});
