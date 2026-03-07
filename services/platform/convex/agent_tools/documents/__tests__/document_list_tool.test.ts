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

  it('clamps limit to max 50', async () => {
    const ctx = createMockCtx();

    await listDocuments(ctx as never, { limit: 100 });

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-list-for-agent',
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('clamps limit to min 1', async () => {
    const ctx = createMockCtx();

    await listDocuments(ctx as never, { limit: -5 });

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-list-for-agent',
      expect.objectContaining({ limit: 1 }),
    );
  });

  it('defaults limit to 20', async () => {
    const ctx = createMockCtx();

    await listDocuments(ctx as never, {});

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-list-for-agent',
      expect.objectContaining({ limit: 20 }),
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
