import { AppError } from '../../lib/shared/errors/app-error';

// Convex bounds a single function execution to ~32k documents read / 16 MiB
// total. The WebDAV recursive subtree walks — cascade DELETE, server-side
// COPY, post-MOVE folderPath fixup, and the legal-hold pre-walk — read every
// folder and document in the subtree within ONE mutation transaction. An
// unbounded tree would crash mid-mutation against that ceiling, and a cascade
// that throws partway can leave a half-trashed tree.
//
// This read budget bounds the rows touched across a walk and refuses cleanly
// with SUBTREE_TOO_LARGE (mapped to 507 Insufficient Storage by the method
// handlers) BEFORE the ceiling, so the failure is predictable and atomic.
//
// NOTE: this is a row-count guard. Documents carry an inline `content`
// string, so a content-heavy subtree can still approach the 16 MiB byte
// limit below this row cap; full support for arbitrarily large trees needs
// batched/continuation deletion (tracked as a follow-up). The cap is set
// well under the row ceiling to leave byte headroom.
export const MAX_WEBDAV_BULK_NODES = 5_000;

export interface ReadBudget {
  remaining: number;
}

export function newReadBudget(max: number = MAX_WEBDAV_BULK_NODES): ReadBudget {
  return { remaining: max };
}

// Per-query cap to pass to `.take()`. Reading at most `remaining + 1` rows
// both bounds the individual query and lets chargeReadBudget detect overflow.
export function budgetTake(budget: ReadBudget): number {
  return budget.remaining + 1;
}

// Charge the rows just read; throw before the walk can exceed its budget.
export function chargeReadBudget(budget: ReadBudget, rowsRead: number): void {
  budget.remaining -= rowsRead;
  if (budget.remaining < 0) {
    throw new AppError({ code: 'SUBTREE_TOO_LARGE' });
  }
}
