import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { listTasksByProjectPaginated } from './list_tasks_paginated';

function createMockQueryBuilder(
  documents: Array<Record<string, unknown>> = [],
) {
  const paginateResult = {
    page: documents,
    isDone: true,
    continueCursor: documents.length > 0 ? 'cursor_1' : '',
  };

  const builder = {
    withIndex: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    filter: vi.fn().mockReturnThis(),
    paginate: vi.fn().mockResolvedValue(paginateResult),
  };

  const ctx = {
    db: {
      query: vi.fn().mockReturnValue(builder),
    },
  };

  return { ctx, builder, paginateResult };
}

const DEFAULT_PAGINATION_OPTS = { numItems: 20, cursor: null, id: 0 };
const PROJECT_ID = 'project_1' as Id<'projects'>;

describe('listTasksByProjectPaginated', () => {
  it('walks by_project_status_rank in ascending (status, rank) order', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listTasksByProjectPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      projectId: PROJECT_ID,
      includeArchived: true,
    });

    expect(ctx.db.query).toHaveBeenCalledWith('tasks');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_project_status_rank',
      expect.any(Function),
    );
    expect(builder.order).toHaveBeenCalledWith('asc');
    // includeArchived: true ⇒ no archived filter, and no other facets given.
    expect(builder.filter).not.toHaveBeenCalled();
    expect(builder.paginate).toHaveBeenCalledWith(DEFAULT_PAGINATION_OPTS);
  });

  it('excludes archived rows by default (a .filter())', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listTasksByProjectPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      projectId: PROJECT_ID,
    });

    // The archived exclusion is the only facet here.
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('filters by externalSystem when provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listTasksByProjectPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      projectId: PROJECT_ID,
      externalSystem: 'github',
      includeArchived: true,
    });

    // Still the (status, rank) index — externalSystem is a post-filter.
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_project_status_rank',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('filters by status when provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listTasksByProjectPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      projectId: PROJECT_ID,
      status: 'in_progress',
      includeArchived: true,
    });

    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('drops each excluded status with its own .filter() (hide done)', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listTasksByProjectPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      projectId: PROJECT_ID,
      excludeStatuses: ['done', 'cancelled'],
      includeArchived: true,
    });

    // One negative filter per excluded status — config-driven, nothing hardcoded.
    expect(builder.filter).toHaveBeenCalledTimes(2);
  });

  it('stacks externalSystem + status + archived as three filters', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listTasksByProjectPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      projectId: PROJECT_ID,
      externalSystem: 'github',
      status: 'in_progress',
      // includeArchived omitted ⇒ archived exclusion applies too.
    });

    expect(builder.filter).toHaveBeenCalledTimes(3);
  });

  it('returns the pagination result unchanged', async () => {
    const docs = [
      { _id: 't_1', title: 'A', status: 'todo' },
      { _id: 't_2', title: 'B', status: 'in_progress' },
    ];
    const { ctx, paginateResult } = createMockQueryBuilder(docs);

    const result = await listTasksByProjectPaginated(
      ctx as unknown as QueryCtx,
      {
        paginationOpts: DEFAULT_PAGINATION_OPTS,
        projectId: PROJECT_ID,
        includeArchived: true,
      },
    );

    expect(result).toBe(paginateResult);
    expect(result.page).toHaveLength(2);
  });

  it('passes paginationOpts through to paginate (cursor + numItems)', async () => {
    const { ctx, builder } = createMockQueryBuilder();
    const opts = { numItems: 50, cursor: 'abc123', id: 3 };

    await listTasksByProjectPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      projectId: PROJECT_ID,
      includeArchived: true,
    });

    expect(builder.paginate).toHaveBeenCalledWith(opts);
  });
});
