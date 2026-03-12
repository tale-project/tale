import { describe, expect, it, vi } from 'vitest';

import { documentFindArgs } from '../document_find_tool';
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

  it('passes limit through to runQuery', async () => {
    const ctx = createMockCtx();

    await listDocuments(ctx as never, { limit: 50 });

    expect(ctx.runQuery).toHaveBeenCalledWith(
      'mock-list-for-agent',
      expect.objectContaining({ limit: 50 }),
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

  it('throws on semantically invalid date like 2026-13-45', async () => {
    const ctx = createMockCtx();

    await expect(
      listDocuments(ctx as never, { dateFrom: '2026-13-45' }),
    ).rejects.toThrow('Invalid date: "2026-13-45"');
  });

  it('throws on non-date string', async () => {
    const ctx = createMockCtx();

    await expect(
      listDocuments(ctx as never, { dateFrom: 'not-a-date' }),
    ).rejects.toThrow('Invalid date');
  });

  it('throws on invalid dateTo', async () => {
    const ctx = createMockCtx();

    await expect(
      listDocuments(ctx as never, { dateTo: '2026-00-01' }),
    ).rejects.toThrow('Invalid date');
  });

  it('throws on date rollover like 2026-02-30', async () => {
    const ctx = createMockCtx();

    await expect(
      listDocuments(ctx as never, { dateFrom: '2026-02-30' }),
    ).rejects.toThrow('Invalid date: "2026-02-30"');
  });

  it('throws on date rollover like 2026-04-31', async () => {
    const ctx = createMockCtx();

    await expect(
      listDocuments(ctx as never, { dateTo: '2026-04-31' }),
    ).rejects.toThrow('Invalid date: "2026-04-31"');
  });

  it('accepts valid dates', async () => {
    const ctx = createMockCtx();

    await listDocuments(ctx as never, {
      dateFrom: '2026-01-15',
      dateTo: '2026-12-31',
    });

    const args = ctx.runQuery.mock.calls[0]?.[1];
    expect(Number.isFinite(args.dateFrom)).toBe(true);
    expect(Number.isFinite(args.dateTo)).toBe(true);
  });

  it('returns empty with warning when dateFrom is after dateTo', async () => {
    const ctx = createMockCtx();

    const result = await listDocuments(ctx as never, {
      dateFrom: '2026-03-15',
      dateTo: '2026-03-01',
    });

    expect(result.documents).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.warning).toContain('dateFrom is after dateTo');
    expect(ctx.runQuery).not.toHaveBeenCalled();
  });

  it('forwards all filter arguments', async () => {
    const ctx = createMockCtx();

    await listDocuments(ctx as never, {
      folderPath: 'contracts',
      extension: 'pdf',
      teamId: 'team1',
      fileName: 'report',
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
        fileName: 'report',
        sortBy: 'name',
        sortOrder: 'asc',
        cursor: 12345,
      }),
    );
  });
});

describe('documentFindArgs schema validation', () => {
  it('accepts valid args with no fields', () => {
    expect(() => documentFindArgs.parse({})).not.toThrow();
  });

  it('accepts valid date format', () => {
    const result = documentFindArgs.parse({ dateFrom: '2026-01-15' });
    expect(result.dateFrom).toBe('2026-01-15');
  });

  it('rejects invalid date format', () => {
    expect(() => documentFindArgs.parse({ dateFrom: '01-15-2026' })).toThrow();
    expect(() => documentFindArgs.parse({ dateFrom: '2026/01/15' })).toThrow();
  });

  it('rejects invalid sortBy enum', () => {
    expect(() => documentFindArgs.parse({ sortBy: 'invalid' })).toThrow();
  });

  it('rejects limit below 1', () => {
    expect(() => documentFindArgs.parse({ limit: 0 })).toThrow();
  });

  it('rejects limit above 50', () => {
    expect(() => documentFindArgs.parse({ limit: 51 })).toThrow();
  });

  it('rejects float limit', () => {
    expect(() => documentFindArgs.parse({ limit: 1.5 })).toThrow();
  });

  it('accepts limit of 1', () => {
    const result = documentFindArgs.parse({ limit: 1 });
    expect(result.limit).toBe(1);
  });

  it('rejects negative cursor', () => {
    expect(() => documentFindArgs.parse({ cursor: -1 })).toThrow();
  });

  it('rejects float cursor', () => {
    expect(() => documentFindArgs.parse({ cursor: 1.5 })).toThrow();
  });

  it('accepts zero cursor', () => {
    const result = documentFindArgs.parse({ cursor: 0 });
    expect(result.cursor).toBe(0);
  });

  it('strips leading dot from extension', () => {
    const result = documentFindArgs.parse({ extension: '.pdf' });
    expect(result.extension).toBe('pdf');
  });

  it('accepts extension without dot', () => {
    const result = documentFindArgs.parse({ extension: 'pdf' });
    expect(result.extension).toBe('pdf');
  });

  it('rejects empty extension', () => {
    expect(() => documentFindArgs.parse({ extension: '' })).toThrow();
  });

  it('rejects empty teamId', () => {
    expect(() => documentFindArgs.parse({ teamId: '' })).toThrow();
  });

  it('lowercases extension', () => {
    const result = documentFindArgs.parse({ extension: 'PDF' });
    expect(result.extension).toBe('pdf');
  });

  it('lowercases extension with dot', () => {
    const result = documentFindArgs.parse({ extension: '.DOCX' });
    expect(result.extension).toBe('docx');
  });

  it('rejects folderPath exceeding 500 chars', () => {
    expect(() =>
      documentFindArgs.parse({ folderPath: 'a'.repeat(501) }),
    ).toThrow();
  });

  it('rejects fileName exceeding 200 chars', () => {
    expect(() =>
      documentFindArgs.parse({ fileName: 'a'.repeat(201) }),
    ).toThrow();
  });

  it('accepts folderPath at 500 chars', () => {
    const result = documentFindArgs.parse({ folderPath: 'a'.repeat(500) });
    expect(result.folderPath).toHaveLength(500);
  });
});
