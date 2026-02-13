import { describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../_generated/server';

import { listProductsPaginated } from './list_products_paginated';

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

describe('listProductsPaginated', () => {
  it('uses by_organizationId index when no filters', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listProductsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
    });

    expect(ctx.db.query).toHaveBeenCalledWith('products');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId',
      expect.any(Function),
    );
    expect(builder.order).toHaveBeenCalledWith('desc');
    expect(builder.filter).not.toHaveBeenCalled();
    expect(builder.paginate).toHaveBeenCalledWith(DEFAULT_PAGINATION_OPTS);
  });

  it('dispatches to by_organizationId_and_status when status is provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listProductsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'active',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_status',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('dispatches to by_organizationId_and_category when category is provided (no status)', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listProductsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      category: 'electronics',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_category',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('uses status index and filters category when both are provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listProductsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'active',
      category: 'electronics',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_status',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('returns pagination result', async () => {
    const docs = [
      { _id: 'p_1', name: 'Widget', status: 'active' },
      { _id: 'p_2', name: 'Gadget', status: 'draft' },
    ];
    const { ctx, paginateResult } = createMockQueryBuilder(docs);

    const result = await listProductsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
    });

    expect(result).toBe(paginateResult);
    expect(result.page).toHaveLength(2);
  });

  it('passes paginationOpts through to paginate', async () => {
    const { ctx, builder } = createMockQueryBuilder();
    const opts = { numItems: 50, cursor: 'abc123', id: 3 };

    await listProductsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
    });

    expect(builder.paginate).toHaveBeenCalledWith(opts);
  });
});
