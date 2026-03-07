import { describe, expect, it, vi } from 'vitest';

import { listDocuments } from '../helpers/list_documents';

vi.mock('../../../_generated/api', () => ({
  internal: {
    documents: {
      internal_queries: {
        listForAgent: 'mock-list-for-agent',
      },
    },
  },
}));

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org1',
    userId: 'user1',
    runQuery: vi.fn().mockResolvedValue({
      documents: [],
      totalCount: 0,
      hasMore: false,
      cursor: null,
    }),
    ...overrides,
  };
}

describe('listDocuments helper', () => {
  it('throws when organizationId is missing', async () => {
    const ctx = createMockCtx({ organizationId: undefined });

    await expect(listDocuments(ctx as never, {})).rejects.toThrow(
      'organizationId is required',
    );
  });

  it('throws when userId is missing', async () => {
    const ctx = createMockCtx({ userId: undefined });

    await expect(listDocuments(ctx as never, {})).rejects.toThrow(
      'userId is required',
    );
  });

  it('passes limit through to runQuery without clamping', async () => {
    const ctx = createMockCtx();

    await listDocuments(ctx as never, { limit: 100 });

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-list-for-agent',
      expect.objectContaining({ limit: 100 }),
    );
  });

  it('passes undefined limit when not provided', async () => {
    const ctx = createMockCtx();

    await listDocuments(ctx as never, {});

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-list-for-agent',
      expect.objectContaining({ limit: undefined }),
    );
  });

  it('converts ISO date strings to timestamps', async () => {
    const ctx = createMockCtx();

    await listDocuments(ctx as never, {
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
    });

    const args = ctx.runQuery.mock.calls[0]?.[1];
    expect(args.dateFrom).toBe(new Date('2026-01-01').getTime());
    expect(args.dateTo).toBe(new Date('2026-03-31').getTime() + 86_400_000 - 1);
  });

  it('returns the exact result from runQuery', async () => {
    const mockResult = {
      documents: [
        {
          id: 'doc1',
          title: 'test.pdf',
          extension: 'pdf',
          folderPath: null,
          teamId: null,
          createdAt: 1000,
          sizeBytes: 500,
        },
      ],
      totalCount: 1,
      hasMore: false,
      cursor: null,
    };
    const ctx = createMockCtx();
    ctx.runQuery.mockResolvedValue(mockResult);

    const result = await listDocuments(ctx as never, {});

    expect(result).toEqual(mockResult);
  });

  it('passes NaN to runQuery when dateFrom is invalid (current behavior)', async () => {
    const ctx = createMockCtx();

    await listDocuments(ctx as never, { dateFrom: 'not-a-date' });

    const args = ctx.runQuery.mock.calls[0]?.[1];
    expect(Number.isNaN(args.dateFrom)).toBe(true);
  });

  it('forwards all filter arguments', async () => {
    const ctx = createMockCtx();

    await listDocuments(ctx as never, {
      folderPath: 'contracts',
      extension: 'pdf',
      teamId: 'team1',
      query: 'report',
      sortBy: 'name',
      sortOrder: 'asc',
      cursor: 12345,
    });

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-list-for-agent',
      expect.objectContaining({
        organizationId: 'org1',
        userId: 'user1',
        folderPath: 'contracts',
        extension: 'pdf',
        teamId: 'team1',
        query: 'report',
        sortBy: 'name',
        sortOrder: 'asc',
        cursor: 12345,
      }),
    );
  });
});
