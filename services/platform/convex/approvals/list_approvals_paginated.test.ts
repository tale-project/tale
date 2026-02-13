import { describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../_generated/server';

import { listApprovalsPaginated } from './list_approvals_paginated';

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

describe('listApprovalsPaginated', () => {
  it('uses by_organizationId index when no filters', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listApprovalsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
    });

    expect(ctx.db.query).toHaveBeenCalledWith('approvals');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId',
      expect.any(Function),
    );
    expect(builder.order).toHaveBeenCalledWith('desc');
    expect(builder.filter).not.toHaveBeenCalled();
    expect(builder.paginate).toHaveBeenCalledWith(DEFAULT_PAGINATION_OPTS);
  });

  it('dispatches to by_org_status when status is provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listApprovalsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'pending',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_status',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('dispatches to by_org_resourceType when resourceType is provided (no status)', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listApprovalsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      resourceType: 'product_recommendation',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_resourceType',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('uses status index and filters resourceType when both are provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listApprovalsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'pending',
      resourceType: 'product_recommendation',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_status',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('applies excludeStatus filter', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listApprovalsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      resourceType: 'product_recommendation',
      excludeStatus: 'pending',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_resourceType',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('applies both resourceType filter and excludeStatus filter when status is primary', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listApprovalsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'approved',
      resourceType: 'product_recommendation',
      excludeStatus: 'pending',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_status',
      expect.any(Function),
    );
    // resourceType filter + excludeStatus filter
    expect(builder.filter).toHaveBeenCalledTimes(2);
  });

  it('returns pagination result', async () => {
    const docs = [
      { _id: 'a_1', status: 'pending', resourceType: 'product_recommendation' },
      {
        _id: 'a_2',
        status: 'approved',
        resourceType: 'product_recommendation',
      },
    ];
    const { ctx, paginateResult } = createMockQueryBuilder(docs);

    const result = await listApprovalsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
    });

    expect(result).toBe(paginateResult);
    expect(result.page).toHaveLength(2);
  });

  it('passes paginationOpts through to paginate', async () => {
    const { ctx, builder } = createMockQueryBuilder();
    const opts = { numItems: 50, cursor: 'abc123', id: 3 };

    await listApprovalsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
    });

    expect(builder.paginate).toHaveBeenCalledWith(opts);
  });
});
