import { describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../../_generated/server';

import { listExecutionsPaginatedNative } from './list_executions_paginated_native';

/**
 * Creates a mock query builder that tracks chained calls and returns
 * a configurable pagination result.
 */
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

describe('listExecutionsPaginatedNative', () => {
  it('uses by_definition_startedAt index without triggeredBy', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listExecutionsPaginatedNative(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      wfDefinitionId: 'def_1',
    });

    expect(ctx.db.query).toHaveBeenCalledWith('wfExecutions');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_definition_startedAt',
      expect.any(Function),
    );
    expect(builder.order).toHaveBeenCalledWith('desc');
    expect(builder.paginate).toHaveBeenCalledWith(DEFAULT_PAGINATION_OPTS);
  });

  it('uses by_definition_triggeredBy_startedAt index with triggeredBy', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listExecutionsPaginatedNative(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      wfDefinitionId: 'def_1',
      triggeredBy: 'schedule',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_definition_triggeredBy_startedAt',
      expect.any(Function),
    );
  });

  it('applies status filter when status is provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listExecutionsPaginatedNative(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      wfDefinitionId: 'def_1',
      status: ['completed', 'failed'],
    });

    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('does not apply filter when no status is provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listExecutionsPaginatedNative(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      wfDefinitionId: 'def_1',
    });

    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('does not apply filter when status array is empty', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listExecutionsPaginatedNative(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      wfDefinitionId: 'def_1',
      status: [],
    });

    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('returns pagination result from query', async () => {
    const docs = [
      { _id: 'exec_1', status: 'completed', startedAt: 1000 },
      { _id: 'exec_2', status: 'failed', startedAt: 900 },
    ];
    const { ctx, paginateResult } = createMockQueryBuilder(docs);

    const result = await listExecutionsPaginatedNative(
      ctx as unknown as QueryCtx,
      {
        paginationOpts: DEFAULT_PAGINATION_OPTS,
        wfDefinitionId: 'def_1',
      },
    );

    expect(result).toBe(paginateResult);
    expect(result.page).toHaveLength(2);
  });

  it('passes paginationOpts through to paginate', async () => {
    const { ctx, builder } = createMockQueryBuilder();
    const opts = { numItems: 50, cursor: 'abc123', id: 3 };

    await listExecutionsPaginatedNative(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      wfDefinitionId: 'def_1',
    });

    expect(builder.paginate).toHaveBeenCalledWith(opts);
  });
});
