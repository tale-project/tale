import { describe, expect, it, vi } from 'vitest';

import type { MutationCtx } from '../_generated/server';

import { cleanupWebsitePagesBatch } from './cleanup_website';

type MockId = string;

function createMockPage(id: string) {
  return { _id: id, websiteId: 'website_1' };
}

function createMockEmbedding(id: string) {
  return { _id: id };
}

function asyncIterable<T>(items: T[]) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < items.length) {
            return { value: items[i++], done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
}

function createMockCtx(
  pages: Array<{ _id: string }>,
  embeddingsByPage: Record<string, Array<{ _id: string }>>,
) {
  const deletedIds: string[] = [];

  const queryMock = vi.fn().mockImplementation((table: string) => {
    if (table === 'websitePages') {
      return {
        withIndex: vi.fn().mockReturnValue(asyncIterable(pages)),
      };
    }
    return {
      withIndex: vi
        .fn()
        .mockImplementation((_indexName: string, fn: Function) => {
          const filter = { eq: vi.fn().mockReturnValue({ pageId: '' }) };
          fn(filter);
          const pageId = filter.eq.mock.calls[0]?.[1];
          const embeddings = embeddingsByPage[pageId] ?? [];
          return asyncIterable(embeddings);
        }),
    };
  });

  const ctx = {
    db: {
      query: queryMock,
      delete: vi.fn().mockImplementation(async (id: string) => {
        deletedIds.push(id);
      }),
    },
  };

  return { ctx, deletedIds };
}

describe('cleanupWebsitePagesBatch', () => {
  it('returns hasMore: false when no pages exist', async () => {
    const { ctx } = createMockCtx([], {});

    const result = await cleanupWebsitePagesBatch(
      ctx as unknown as MutationCtx,
      'website_1' as MockId as never,
    );

    expect(result).toEqual({ hasMore: false });
  });

  it('deletes page and its embeddings', async () => {
    const page = createMockPage('page_1');
    const embeddings = [
      createMockEmbedding('emb_1'),
      createMockEmbedding('emb_2'),
    ];

    const { ctx, deletedIds } = createMockCtx([page], { page_1: embeddings });

    const result = await cleanupWebsitePagesBatch(
      ctx as unknown as MutationCtx,
      'website_1' as MockId as never,
    );

    expect(result).toEqual({ hasMore: false });
    expect(deletedIds).toContain('emb_1');
    expect(deletedIds).toContain('emb_2');
    expect(deletedIds).toContain('page_1');
  });

  it('returns hasMore: true when batch size exceeded', async () => {
    const pages = Array.from({ length: 21 }, (_, i) =>
      createMockPage(`page_${i}`),
    );

    const { ctx } = createMockCtx(pages, {});

    const result = await cleanupWebsitePagesBatch(
      ctx as unknown as MutationCtx,
      'website_1' as MockId as never,
    );

    expect(result).toEqual({ hasMore: true });
    expect(ctx.db.delete).toHaveBeenCalledTimes(20);
  });

  it('queries all 7 embedding tables per page', async () => {
    const page = createMockPage('page_1');
    const { ctx } = createMockCtx([page], {});

    await cleanupWebsitePagesBatch(
      ctx as unknown as MutationCtx,
      'website_1' as MockId as never,
    );

    const queriedTables = ctx.db.query.mock.calls.map(
      (call: string[]) => call[0],
    );
    expect(queriedTables).toContain('websitePageEmbeddings256');
    expect(queriedTables).toContain('websitePageEmbeddings512');
    expect(queriedTables).toContain('websitePageEmbeddings1024');
    expect(queriedTables).toContain('websitePageEmbeddings1536');
    expect(queriedTables).toContain('websitePageEmbeddings2048');
    expect(queriedTables).toContain('websitePageEmbeddings2560');
    expect(queriedTables).toContain('websitePageEmbeddings4096');
  });
});
