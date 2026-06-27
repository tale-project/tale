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
  /** Keep only this status (drives the view's status filter). Pinned into the
   *  index range so a filtered list stays dense — no post-filter page thinning. */
  status?: Doc<'tasks'>['status'];
  includeArchived?: boolean;
}

export async function listTasksByProjectPaginated(
  ctx: QueryCtx,
  args: ListTasksByProjectPaginatedArgs,
): Promise<PaginationResult<Doc<'tasks'>>> {
  // Narrow the index to (projectId[, status]); ascending → (status, rank) order,
  // matching the board's client-side sort. Pinning `status` keeps a status-
  // filtered page dense instead of thinning it with a post-filter.
  let query = ctx.db
    .query('tasks')
    .withIndex('by_project_status_rank', (q) => {
      const scoped = q.eq('projectId', args.projectId);
      return args.status !== undefined
        ? scoped.eq('status', args.status)
        : scoped;
    })
    .order('asc');

  if (args.externalSystem !== undefined) {
    const externalSystem = args.externalSystem;
    query = query.filter((q) =>
      q.eq(q.field('externalSystem'), externalSystem),
    );
  }
  if (!args.includeArchived) {
    query = query.filter((q) => q.eq(q.field('archivedAt'), undefined));
  }

  return await query.paginate(args.paginationOpts);
}
