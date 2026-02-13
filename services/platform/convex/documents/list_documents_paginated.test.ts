import { describe, expect, it, vi } from 'vitest';

import type { QueryCtx } from '../_generated/server';

import { listDocumentsPaginated } from './list_documents_paginated';

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
    storage: {
      getUrl: vi.fn().mockResolvedValue(null),
    },
  };

  return { ctx, builder, paginateResult };
}

const DEFAULT_PAGINATION_OPTS = { numItems: 20, cursor: null, id: 0 };

describe('listDocumentsPaginated', () => {
  it('uses by_organizationId index when no filters', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listDocumentsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      userTeamIds: [],
    });

    expect(ctx.db.query).toHaveBeenCalledWith('documents');
    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId',
      expect.any(Function),
    );
    expect(builder.order).toHaveBeenCalledWith('desc');
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('dispatches to by_organizationId_and_sourceProvider when sourceProvider is provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listDocumentsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      sourceProvider: 'upload',
      userTeamIds: [],
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_sourceProvider',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('dispatches to by_organizationId_and_extension when extension is provided (no sourceProvider)', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listDocumentsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      extension: 'pdf',
      userTeamIds: [],
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_extension',
      expect.any(Function),
    );
    expect(builder.filter).not.toHaveBeenCalled();
  });

  it('uses sourceProvider index and filters extension when both are provided', async () => {
    const { ctx, builder } = createMockQueryBuilder();

    await listDocumentsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      sourceProvider: 'upload',
      extension: 'pdf',
      userTeamIds: [],
    });

    expect(builder.withIndex).toHaveBeenCalledWith(
      'by_organizationId_and_sourceProvider',
      expect.any(Function),
    );
    expect(builder.filter).toHaveBeenCalledTimes(1);
  });

  it('filters out documents without team access', async () => {
    const docs = [
      {
        _id: 'd_1',
        _creationTime: 1000,
        title: 'Public',
        organizationId: 'org_1',
      },
      {
        _id: 'd_2',
        _creationTime: 1001,
        title: 'Team Only',
        organizationId: 'org_1',
        teamId: 'team_a',
      },
      {
        _id: 'd_3',
        _creationTime: 1002,
        title: 'Other Team',
        organizationId: 'org_1',
        teamId: 'team_b',
      },
    ];
    const { ctx } = createMockQueryBuilder(docs);

    const result = await listDocumentsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      userTeamIds: ['team_a'],
    });

    expect(result.page).toHaveLength(2);
    expect(result.page.map((d) => d.id)).toEqual(['d_1', 'd_2']);
  });

  it('allows all documents when no team restrictions', async () => {
    const docs = [
      {
        _id: 'd_1',
        _creationTime: 1000,
        title: 'Doc 1',
        organizationId: 'org_1',
      },
      {
        _id: 'd_2',
        _creationTime: 1001,
        title: 'Doc 2',
        organizationId: 'org_1',
      },
    ];
    const { ctx } = createMockQueryBuilder(docs);

    const result = await listDocumentsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      userTeamIds: [],
    });

    expect(result.page).toHaveLength(2);
  });

  it('passes paginationOpts through to paginate', async () => {
    const { ctx, builder } = createMockQueryBuilder();
    const opts = { numItems: 50, cursor: 'abc123', id: 3 };

    await listDocumentsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: opts,
      organizationId: 'org_1',
      userTeamIds: [],
    });

    expect(builder.paginate).toHaveBeenCalledWith(opts);
  });

  it('preserves isDone and continueCursor from pagination result', async () => {
    const { ctx } = createMockQueryBuilder();

    const result = await listDocumentsPaginated(ctx as unknown as QueryCtx, {
      paginationOpts: DEFAULT_PAGINATION_OPTS,
      organizationId: 'org_1',
      userTeamIds: [],
    });

    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBe('');
  });
});
