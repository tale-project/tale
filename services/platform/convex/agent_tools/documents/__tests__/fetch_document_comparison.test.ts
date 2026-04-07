import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDocumentComparison } from '../helpers/fetch_document_comparison';

const RAG_URL = 'http://mock-rag:8001';
const BASE_FILE_ID = 'file-base-123';
const COMP_FILE_ID = 'file-comp-456';

const originalFetch = globalThis.fetch;

function createRagCompareResponse(overrides?: Record<string, unknown>) {
  return {
    success: true,
    base_document: { file_id: BASE_FILE_ID, title: 'Base Doc' },
    comparison_document: { file_id: COMP_FILE_ID, title: 'Comparison Doc' },
    change_blocks: [
      {
        context_before: 'Some context before',
        items: [
          {
            type: 'modified',
            base_content: 'old text',
            comparison_content: 'new text',
            content: null,
            inline_diff: 'old -> new',
            clause_ref: '1.1',
            base_page: 1,
            comparison_page: 1,
          },
        ],
        context_after: 'Some context after',
      },
    ],
    stats: {
      total_paragraphs_base: 10,
      total_paragraphs_comparison: 12,
      unchanged: 8,
      modified: 1,
      added: 2,
      deleted: 1,
      high_divergence: false,
    },
    truncated: false,
    ...overrides,
  };
}

function mockFetchSuccess(body: Record<string, unknown>) {
  globalThis.fetch = Object.assign(
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
    { preconnect: vi.fn() },
  );
}

beforeEach(() => {
  mockFetchSuccess(createRagCompareResponse());
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchDocumentComparison', () => {
  it('returns correctly mapped result on happy path', async () => {
    const result = await fetchDocumentComparison(
      RAG_URL,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.baseDocument).toEqual({
      fileId: BASE_FILE_ID,
      title: 'Base Doc',
    });
    expect(result.comparisonDocument).toEqual({
      fileId: COMP_FILE_ID,
      title: 'Comparison Doc',
    });
    expect(result.truncated).toBe(false);
    expect(result.stats).toEqual({
      totalParagraphsBase: 10,
      totalParagraphsComparison: 12,
      unchanged: 8,
      modified: 1,
      added: 2,
      deleted: 1,
      highDivergence: false,
    });
  });

  it('maps change blocks with all diff item fields', async () => {
    const result = await fetchDocumentComparison(
      RAG_URL,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.changeBlocks).toHaveLength(1);
    const block = result.changeBlocks[0];
    expect(block.contextBefore).toBe('Some context before');
    expect(block.contextAfter).toBe('Some context after');
    expect(block.items).toHaveLength(1);

    const item = block.items[0];
    expect(item.type).toBe('modified');
    expect(item.baseContent).toBe('old text');
    expect(item.comparisonContent).toBe('new text');
    expect(item.content).toBeNull();
    expect(item.inlineDiff).toBe('old -> new');
    expect(item.clauseRef).toBe('1.1');
    expect(item.basePage).toBe(1);
    expect(item.comparisonPage).toBe(1);
  });

  it('defaults nullable diff item fields to null', async () => {
    mockFetchSuccess(
      createRagCompareResponse({
        change_blocks: [
          {
            context_before: null,
            items: [
              {
                type: 'added',
                base_content: null,
                comparison_content: 'new paragraph',
                content: null,
              },
            ],
            context_after: null,
          },
        ],
      }),
    );

    const result = await fetchDocumentComparison(
      RAG_URL,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    const item = result.changeBlocks[0].items[0];
    expect(item.inlineDiff).toBeNull();
    expect(item.clauseRef).toBeNull();
    expect(item.basePage).toBeNull();
    expect(item.comparisonPage).toBeNull();
  });

  it('sends POST request with correct body', async () => {
    await fetchDocumentComparison(RAG_URL, BASE_FILE_ID, COMP_FILE_ID);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${RAG_URL}/api/v1/documents/compare`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_file_id: BASE_FILE_ID,
          comparison_file_id: COMP_FILE_ID,
        }),
      }),
    );
  });

  it('includes max_changes in body when provided', async () => {
    await fetchDocumentComparison(RAG_URL, BASE_FILE_ID, COMP_FILE_ID, 50);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: JSON.stringify({
          base_file_id: BASE_FILE_ID,
          comparison_file_id: COMP_FILE_ID,
          max_changes: 50,
        }),
      }),
    );
  });

  it('omits max_changes from body when not provided', async () => {
    await fetchDocumentComparison(RAG_URL, BASE_FILE_ID, COMP_FILE_ID);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: JSON.stringify({
          base_file_id: BASE_FILE_ID,
          comparison_file_id: COMP_FILE_ID,
        }),
      }),
    );
  });

  it('throws on RAG 404', async () => {
    globalThis.fetch = Object.assign(
      vi
        .fn()
        .mockResolvedValue(new Response('Document not found', { status: 404 })),
      { preconnect: vi.fn() },
    );

    await expect(
      fetchDocumentComparison(RAG_URL, BASE_FILE_ID, COMP_FILE_ID),
    ).rejects.toThrow('Document not found during comparison');
  });

  it('throws on RAG 400', async () => {
    globalThis.fetch = Object.assign(
      vi
        .fn()
        .mockResolvedValue(
          new Response('Missing base_file_id', { status: 400 }),
        ),
      { preconnect: vi.fn() },
    );

    await expect(
      fetchDocumentComparison(RAG_URL, BASE_FILE_ID, COMP_FILE_ID),
    ).rejects.toThrow('Invalid comparison request');
  });

  it('throws with status on RAG 500', async () => {
    globalThis.fetch = Object.assign(
      vi
        .fn()
        .mockResolvedValue(
          new Response('Internal Server Error', { status: 500 }),
        ),
      { preconnect: vi.fn() },
    );

    await expect(
      fetchDocumentComparison(RAG_URL, BASE_FILE_ID, COMP_FILE_ID),
    ).rejects.toThrow('RAG service error (500)');
  });

  it('throws timeout error when fetch is aborted', async () => {
    globalThis.fetch = Object.assign(
      vi
        .fn()
        .mockRejectedValue(
          new DOMException('The operation was aborted', 'AbortError'),
        ),
      { preconnect: vi.fn() },
    );

    await expect(
      fetchDocumentComparison(RAG_URL, BASE_FILE_ID, COMP_FILE_ID),
    ).rejects.toThrow('timed out after 120s');
  });

  it('re-throws network errors from fetch', async () => {
    globalThis.fetch = Object.assign(
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      { preconnect: vi.fn() },
    );

    await expect(
      fetchDocumentComparison(RAG_URL, BASE_FILE_ID, COMP_FILE_ID),
    ).rejects.toThrow('Failed to fetch');
  });

  it('handles empty change_blocks array', async () => {
    mockFetchSuccess(
      createRagCompareResponse({
        change_blocks: [],
        stats: {
          total_paragraphs_base: 5,
          total_paragraphs_comparison: 5,
          unchanged: 5,
          modified: 0,
          added: 0,
          deleted: 0,
          high_divergence: false,
        },
      }),
    );

    const result = await fetchDocumentComparison(
      RAG_URL,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.changeBlocks).toEqual([]);
    expect(result.stats.unchanged).toBe(5);
  });

  it('handles truncated response', async () => {
    mockFetchSuccess(createRagCompareResponse({ truncated: true }));

    const result = await fetchDocumentComparison(
      RAG_URL,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.truncated).toBe(true);
  });

  it('handles high_divergence flag', async () => {
    mockFetchSuccess(
      createRagCompareResponse({
        stats: {
          total_paragraphs_base: 100,
          total_paragraphs_comparison: 5,
          unchanged: 0,
          modified: 5,
          added: 0,
          deleted: 95,
          high_divergence: true,
        },
      }),
    );

    const result = await fetchDocumentComparison(
      RAG_URL,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.stats.highDivergence).toBe(true);
  });

  it('handles null document titles', async () => {
    mockFetchSuccess(
      createRagCompareResponse({
        base_document: { file_id: BASE_FILE_ID, title: null },
        comparison_document: { file_id: COMP_FILE_ID, title: null },
      }),
    );

    const result = await fetchDocumentComparison(
      RAG_URL,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.baseDocument.title).toBeNull();
    expect(result.comparisonDocument.title).toBeNull();
  });

  it('maps multiple change blocks', async () => {
    mockFetchSuccess(
      createRagCompareResponse({
        change_blocks: [
          {
            context_before: 'ctx1',
            items: [
              {
                type: 'deleted',
                base_content: 'removed',
                comparison_content: null,
                content: null,
              },
            ],
            context_after: null,
          },
          {
            context_before: null,
            items: [
              {
                type: 'added',
                base_content: null,
                comparison_content: 'inserted',
                content: null,
              },
            ],
            context_after: 'ctx2',
          },
        ],
      }),
    );

    const result = await fetchDocumentComparison(
      RAG_URL,
      BASE_FILE_ID,
      COMP_FILE_ID,
    );

    expect(result.changeBlocks).toHaveLength(2);
    expect(result.changeBlocks[0].items[0].type).toBe('deleted');
    expect(result.changeBlocks[1].items[0].type).toBe('added');
  });

  it('passes AbortSignal to fetch', async () => {
    await fetchDocumentComparison(RAG_URL, BASE_FILE_ID, COMP_FILE_ID);

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const options = fetchCall?.[1];
    expect(options).toHaveProperty('signal');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });
});
