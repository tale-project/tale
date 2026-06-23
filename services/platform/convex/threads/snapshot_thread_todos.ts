/**
 * Copy a source thread's todo plan onto a freshly-forked thread.
 *
 * A FORK is a diverging copy (`fork_own_thread` / `fork_thread`), so it takes a
 * one-time snapshot of the source's plan at creation. Unlike files, todos carry
 * no blob, so this runs SYNCHRONOUSLY inside the fork mutation — no action.
 *
 * Direct `ctx.db.insert`, NOT a replay through `applyTodoOperations`: an `add`
 * op forces every item to `status: 'pending'` and zeroes per-item state
 * (`searchCount`/`findingsSummary`/`sources`), which would corrupt a snapshot.
 * The single-active-todo invariant already holds in the source doc (the todo
 * mutation enforced it on every write), so cloning the array verbatim is safe.
 *
 * `recentOpIds` (per-thread idempotency ring) and `integrationCallCount`
 * (per-thread integration budget) are intentionally RESET — the fork is a new
 * conversation with its own idempotency window and budget; carrying them over
 * would pre-spend the fork or mis-reject its first `update_todos` batch.
 */

import type { MutationCtx } from '../_generated/server';

export async function copyThreadTodos(
  ctx: MutationCtx,
  args: {
    sourceThreadId: string;
    newThreadId: string;
    organizationId: string;
  },
): Promise<void> {
  const source = await ctx.db
    .query('threadTodos')
    .withIndex('by_org_thread', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('threadId', args.sourceThreadId),
    )
    .first();
  if (!source || source.todos.length === 0) return;

  // Idempotency guard — re-running the fork (or a retried scheduler) must not
  // create a second todos doc for the same thread.
  const existing = await ctx.db
    .query('threadTodos')
    .withIndex('by_org_thread', (q) =>
      q
        .eq('organizationId', args.organizationId)
        .eq('threadId', args.newThreadId),
    )
    .first();
  if (existing) return;

  const now = Date.now();
  await ctx.db.insert('threadTodos', {
    organizationId: args.organizationId,
    threadId: args.newThreadId,
    todos: source.todos, // verbatim — preserves status / findings / sources
    activeTodoId: source.activeTodoId,
    recentOpIds: [],
    integrationCallCount: 0,
    createdAt: now,
    updatedAt: now,
  });
}
