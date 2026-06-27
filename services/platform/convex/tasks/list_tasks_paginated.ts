/**
 * List a project's tasks via Convex native `.paginate()` for use with
 * `usePaginatedQuery`.
 *
 * Walks `by_project_status_rank` so rows arrive in `(status, rank)` order — the
 * same grouping the board renders — and that order is preserved ACROSS cursor
 * pages (a single stream, one "Load more", grouping intact). The remaining
 * facets (`externalSystem`, `status`, archived) are applied as `.filter()`; a
 * filter can thin a page, which the paginated client handles transparently by
 * loading the next slice while `status === 'CanLoadMore'`.
 *
 * Access control is the caller's job (the `query` wrapper runs
 * `loadAccessibleProject`); this helper takes an already-authorized ctx so it
 * stays unit-testable against a mock ctx — the same split as
 * `list_customers_paginated`.
 */

import type { PaginationOptions, PaginationResult } from 'convex/server';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export interface ListTasksByProjectPaginatedArgs {
  paginationOpts: PaginationOptions;
  projectId: Id<'projects'>;
  /** Scope to tasks linked to an external system (e.g. 'github'). */
  externalSystem?: string;
  /** Keep only this status (a positive filter). */
  status?: string;
  /** Drop these statuses (a negative filter) — lets a view hide e.g. `done`
   *  tasks via config, with no status names hardcoded in the component. */
  excludeStatuses?: string[];
  includeArchived?: boolean;
}

export async function listTasksByProjectPaginated(
  ctx: QueryCtx,
  args: ListTasksByProjectPaginatedArgs,
): Promise<PaginationResult<Doc<'tasks'>>> {
  let query = ctx.db
    .query('tasks')
    .withIndex('by_project_status_rank', (q) =>
      q.eq('projectId', args.projectId),
    )
    // Ascending → (status, rank) order, matching the board's client-side sort.
    .order('asc');

  if (args.externalSystem !== undefined) {
    const externalSystem = args.externalSystem;
    query = query.filter((q) =>
      q.eq(q.field('externalSystem'), externalSystem),
    );
  }
  if (args.status !== undefined) {
    const status = args.status;
    query = query.filter((q) => q.eq(q.field('status'), status));
  }
  // Negative status filter (e.g. hide `done`). `const` is per-iteration, so each
  // closure captures its own value. Like the other facets it can thin a page —
  // the paginated client just loads the next slice.
  for (const excluded of args.excludeStatuses ?? []) {
    query = query.filter((q) => q.neq(q.field('status'), excluded));
  }
  if (!args.includeArchived) {
    query = query.filter((q) => q.eq(q.field('archivedAt'), undefined));
  }

  return await query.paginate(args.paginationOpts);
}
