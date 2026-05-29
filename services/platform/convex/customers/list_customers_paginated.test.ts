import { describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../_generated/server';
import { listCustomersPaginated } from './list_customers_paginated';

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

describe('listCustomersPaginated', () => {
  it('uses by_organizationId index when no filters', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
    });

    expect(ctx.db.query).toHaveBeenCalledWith('customers');
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

    await listCustomersPaginated(ctx as unknown as QueryCtx, {
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

  it('dispatches to by_organizationId_and_source when source is provided (no status)', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      source: 'manual_import',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_source',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('dispatches to by_organizationId_and_locale when locale is provided (no status or source)', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      locale: 'en',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_locale',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('uses status index and filters source when both are provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'active',
      source: 'manual_import',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_status',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('uses status index and filters source + locale when all are provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'active',
      source: 'manual_import',
      locale: 'en',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_status',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(2);
  });

  it('returns pagination result', async () => {
    const docs = [
      { _id: 'c_1', name: 'Alice', status: 'active' },
      { _id: 'c_2', name: 'Bob', status: 'churned' },
    ];
    const { ctx, paginateResult } = createMockQueryBuilder(docs);

    const result = await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
    });

    expect(result).toBe(paginateResult);
    expect(result.page).toHaveLength(2);
  });

  it('passes paginationOpts through to paginate', async () => {
    const { ctx, builder } = createMockQueryBuilder();
    const opts = { numItems: 50, cursor: 'abc123', id: 3 };

    await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
    });

    expect(builder.paginate).toHaveBeenCalledWith(opts);
  });
});

describe('listCustomersPaginated — backend search', () => {
  const opts = DEFAULT_PAGINATION_OPTS;

  it('filters the page to term matches over name/email and orders by relevance', async () => {
    const docs = [
      { _id: 'sub', name: 'My Acme config', _creationTime: 3 },
      { _id: 'exact', name: 'Acme', _creationTime: 1 },
      { _id: 'email', name: 'Initech', email: 'ops@acme.io', _creationTime: 2 },
      { _id: 'miss', name: 'Globex', _creationTime: 4 },
    ];
    const { ctx } = createMockQueryBuilder(docs);

    const result = await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
      search: 'acme',
    });

    // 'Globex' is dropped; exact name match ranks first, then the two
    // substring hits break the tie by creation time (newest first).
    expect(result.page.map((r) => r._id)).toEqual(['exact', 'sub', 'email']);
  });

  it('excludes soft-deleted rows (activeOnly strategy)', async () => {
    const docs = [
      { _id: 'live', name: 'Acme', _creationTime: 2 },
      {
        _id: 'trashed',
        name: 'Acme Holdings',
        _creationTime: 3,
        lifecycleStatus: 'trashed',
      },
    ];
    const { ctx } = createMockQueryBuilder(docs);

    const result = await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
      search: 'acme',
    });

    expect(result.page.map((r) => r._id)).toEqual(['live']);
  });

  it('applies status/source/locale as a post-match access filter', async () => {
    const docs = [
      { _id: 'active', name: 'Acme', status: 'active', _creationTime: 2 },
      { _id: 'churned', name: 'Acme Inc', status: 'churned', _creationTime: 3 },
    ];
    const { ctx } = createMockQueryBuilder(docs);

    const result = await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
      search: 'acme',
      status: 'active',
    });

    expect(result.page.map((r) => r._id)).toEqual(['active']);
  });

  it('matches a numeric externalId exactly', async () => {
    const docs = [
      { _id: 'num', name: 'X', externalId: 4242, _creationTime: 1 },
      { _id: 'other', name: 'Y', externalId: 99, _creationTime: 2 },
    ];
    const { ctx } = createMockQueryBuilder(docs);

    const result = await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
      search: '4242',
    });

    expect(result.page.map((r) => r._id)).toEqual(['num']);
  });

  it('returns an empty page but preserves the pagination envelope when nothing matches', async () => {
    const docs = [{ _id: 'a', name: 'Globex', _creationTime: 1 }];
    const { ctx, paginateResult } = createMockQueryBuilder(docs);

    const result = await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
      search: 'zzz',
    });

    // Contract: the page is filtered to empty while isDone/continueCursor pass
    // through untouched, so the client can auto-advance to the next slice.
    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(paginateResult.isDone);
    expect(result.continueCursor).toBe(paginateResult.continueCursor);
  });

  it('scans the org-scoped index (facets become post-filters, not index dispatch)', async () => {
    const { ctx, builder } = createMockQueryBuilder([
      { _id: 'a', name: 'Acme', status: 'active', _creationTime: 1 },
    ]);

    await listCustomersPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
      search: 'acme',
      status: 'active',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId',
      expect.any(Function),
    );
  });
});
