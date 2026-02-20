import { describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../_generated/server';

import { listWebsitePagesPaginated } from './list_website_pages_paginated';

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
    paginate: vi.fn().mockResolvedValue(paginateResult),
  };

  const ctx = {
    db: {
      query: vi.fn().mockReturnValue(builder),
    },
  };

  return { ctx, builder, paginateResult };
}

const DEFAULT_PAGINATION_OPTS = { numItems: 10, cursor: null, id: 0 };

describe('listWebsitePagesPaginated', () => {
  it('queries websitePages with by_websiteId_and_lastCrawledAt index', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listWebsitePagesPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      websiteId: 'website_1' as never,
    });

    expect(ctx.db.query).toHaveBeenCalledWith('websitePages');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_websiteId_and_lastCrawledAt',
      expect.any(Function),
    );
    expect(builder.order).toHaveBeenCalledWith('desc');
    expect(builder.paginate).toHaveBeenCalledWith(DEFAULT_PAGINATION_OPTS);
  });

  it('returns pagination result with pages', async () => {
    const docs = [
      { _id: 'p_1', url: 'https://example.com/page1', content: '# Hello' },
      { _id: 'p_2', url: 'https://example.com/page2', content: '# World' },
    ];
    const { ctx, paginateResult } = createMockQueryBuilder(docs);

    const result = await listWebsitePagesPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      websiteId: 'website_1' as never,
    });

    expect(result).toBe(paginateResult);
    expect(result.page).toHaveLength(2);
  });

  it('returns empty result when no pages exist', async () => {
    const { ctx, paginateResult } = createMockQueryBuilder([]);

    const result = await listWebsitePagesPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      websiteId: 'website_1' as never,
    });

    expect(result).toBe(paginateResult);
    expect(result.page).toHaveLength(0);
    expect(result.isDone).toBe(true);
  });

  it('passes paginationOpts through to paginate', async () => {
    const { ctx, builder } = createMockQueryBuilder();
    const opts = { numItems: 50, cursor: 'abc123', id: 3 };

    await listWebsitePagesPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      websiteId: 'website_1' as never,
    });

    expect(builder.paginate).toHaveBeenCalledWith(opts);
  });
});
