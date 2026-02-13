import { describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../_generated/server';

import { listConversationsPaginated } from './list_conversations_paginated';

vi.mock('./transform_conversation', () => ({
  transformConversation: vi.fn((_ctx, doc) =>
    Promise.resolve({ ...doc, title: 'transformed' }),
  ),
}));

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

describe('listConversationsPaginated', () => {
  it('uses by_organizationId index when no filters', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
    });

    expect(ctx.db.query).toHaveBeenCalledWith('conversations');
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

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'open',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_status',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('dispatches to by_organizationId_and_priority when priority is provided (no status)', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      priority: 'high',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_priority',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('dispatches to by_organizationId_and_channel when channel is provided (no status or priority)', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      channel: 'email',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_channel',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('uses status index and filters priority when both are provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      status: 'open',
      priority: 'high',
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_status',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('transforms each document in the page', async () => {
    const docs = [
      { _id: 'c_1', subject: 'Test 1' },
      { _id: 'c_2', subject: 'Test 2' },
    ];
    const { ctx } = createMockQueryBuilder(docs);

    const result = await listConversationsPaginated(
      ctx as unknown as QueryCtx,
      {
        paginationOpts: DEFAULT_PAGINATION_OPTS,
        organizationId: 'org_1',
      },
    );

    expect(result.page).toHaveLength(2);
    expect(result.page[0]).toHaveProperty('title', 'transformed');
    expect(result.page[1]).toHaveProperty('title', 'transformed');
  });

  it('returns pagination metadata', async () => {
    const docs = [{ _id: 'c_1' }];
    const { ctx } = createMockQueryBuilder(docs);

    const result = await listConversationsPaginated(
      ctx as unknown as QueryCtx,
      {
        paginationOpts: DEFAULT_PAGINATION_OPTS,
        organizationId: 'org_1',
      },
    );

    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBe('cursor_1');
  });

  it('passes paginationOpts through to paginate', async () => {
    const { ctx, builder } = createMockQueryBuilder();
    const opts = { numItems: 50, cursor: 'abc123', id: 3 };

    await listConversationsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
    });

    expect(builder.paginate).toHaveBeenCalledWith(opts);
  });
});
