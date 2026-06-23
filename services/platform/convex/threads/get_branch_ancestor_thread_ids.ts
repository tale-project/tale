/**
 * Resolve the branch-ancestor chain of a chat thread: the thread itself plus
 * every parent branch up to the conversation root, each annotated with the
 * fork-point cut that applies to its artifacts.
 *
 * Branches fork the SAME conversation — forking after message N starts a new
 * thread that carries the prior messages forward. Artifacts (files, todos)
 * written BEFORE the fork live on the pre-fork thread (or its sub-threads), so
 * a pane that only looks at the active branch tip loses them. The Canvas/Plan
 * panes union files across the whole lineage, matching the user's mental model
 * that branching doesn't lose what the conversation already produced.
 *
 * But an ancestor keeps living after the branch splits off: files it writes
 * AFTER the fork point belong to a future this branch didn't take and must NOT
 * appear on the branch. Each hop therefore carries `filesBefore` — the tightest
 * (minimum) `forkOrderCreatedAt` between the active tip and that ancestor. The
 * caller keeps only that ancestor's rows with `createdAt <= filesBefore`. The
 * tip itself has no cut (`filesBefore` undefined) — you see everything on the
 * branch you're viewing. `filesBefore` is also undefined for any hop whose
 * branch row predates the `forkOrderCreatedAt` field (legacy branches degrade
 * to "no cut", i.e. the prior union-everything behaviour).
 *
 * Walks the `threadBranches` table via `by_branchThreadId` → `parentThreadId`.
 * A root thread (never forked) has no `threadBranches` row, so the chain is just
 * the entry thread. Bounded by {@link MAX_BRANCH_DEPTH} + a `visited` set so a
 * malformed cycle can't loop forever. Pure read; no side effects and no auth
 * (the caller authorizes the entry thread, and every ancestor shares its
 * `rootThreadId`/owner — branches are the same user's conversation).
 */

import type { QueryCtx } from '../_generated/server';

const MAX_BRANCH_DEPTH = 64;

export interface BranchAncestorHop {
  threadId: string;
  /**
   * Upper bound (inclusive) on `createdAt` for artifacts surfaced from this
   * ancestor — the tightest fork point between the active tip and here.
   * `undefined` means no cut (the active tip, or a legacy branch row without a
   * stored fork timestamp).
   */
  filesBefore?: number;
}

export async function getBranchAncestorThreadIds(
  ctx: QueryCtx,
  threadId: string,
): Promise<BranchAncestorHop[]> {
  const chain: BranchAncestorHop[] = [{ threadId }];
  const visited = new Set<string>([threadId]);
  let cursor = threadId;
  // The tightest fork cut accumulated so far. A grandparent is bounded by the
  // earliest fork point on the path back to the tip, so we only ever tighten.
  let cut: number | undefined;

  for (let depth = 0; depth < MAX_BRANCH_DEPTH; depth++) {
    const branch = await ctx.db
      .query('threadBranches')
      .withIndex('by_branchThreadId', (q) => q.eq('branchThreadId', cursor))
      .first();
    const parent = branch?.parentThreadId;
    if (!parent || visited.has(parent)) break;

    // Tighten the cut with this hop's fork point. A legacy row without
    // `forkOrderCreatedAt` cannot tighten — it leaves the running cut as-is,
    // which for the first such hop means "no cut" (undefined) and otherwise
    // preserves the tighter bound already found closer to the tip.
    const hopCut = branch?.forkOrderCreatedAt;
    if (hopCut !== undefined) {
      cut = cut === undefined ? hopCut : Math.min(cut, hopCut);
    }

    chain.push({ threadId: parent, filesBefore: cut });
    visited.add(parent);
    cursor = parent;
  }

  return chain;
}
