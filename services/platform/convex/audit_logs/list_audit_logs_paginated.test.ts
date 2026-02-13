import { describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../_generated/server';

import { listAuditLogsPaginated } from './list_audit_logs_paginated';

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

describe('listAuditLogsPaginated', () => {
  it('uses by_organizationId_and_timestamp index when no filters', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listAuditLogsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
    });

    expect(ctx.db.query).toHaveBeenCalledWith('auditLogs');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_timestamp',
      expect.any(Function),
    );
    expect(builder.order).toHaveBeenCalledWith('desc');
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('dispatches to by_org_category_timestamp when category is provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listAuditLogsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      category: 'auth',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_category_timestamp',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('dispatches to by_org_resourceType_timestamp when resourceType is provided (no category)', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listAuditLogsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      resourceType: 'member',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_resourceType_timestamp',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('uses category index and filters resourceType when both are provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listAuditLogsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      category: 'auth',
      resourceType: 'member',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_org_category_timestamp',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('returns pagination result', async () => {
    const docs = [
      { _id: 'al_1', action: 'create', category: 'auth' },
      { _id: 'al_2', action: 'update', category: 'data' },
    ];
    const { ctx, paginateResult } = createMockQueryBuilder(docs);

    const result = await listAuditLogsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
    });

    expect(result).toBe(paginateResult);
    expect(result.page).toHaveLength(2);
  });

  it('passes paginationOpts through to paginate', async () => {
    const { ctx, builder } = createMockQueryBuilder();
    const opts = { numItems: 50, cursor: 'abc123', id: 3 };

    await listAuditLogsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
    });

    expect(builder.paginate).toHaveBeenCalledWith(opts);
  });
});
