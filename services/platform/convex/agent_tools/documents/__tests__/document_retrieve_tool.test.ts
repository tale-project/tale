import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { documentRetrieveArgs } from '../document_retrieve_tool';
import { retrieveDocument } from '../helpers/retrieve_document';

vi.mock('../../../_generated/api', () => ({
  internal: {
    documents: {
      internal_queries: {
        getAccessibleDocumentIds: 'mock-get-accessible-document-ids',
      },
    },
  },
}));

vi.mock('../../../lib/helpers/rag_config', () => ({
  getRagConfig: () => ({ serviceUrl: 'http://mock-rag:8001' }),
}));

const originalFetch = globalThis.fetch;

function createMockCtx(overrides?: Record<string, unknown>) {
  return {
    organizationId: 'org1',
    userId: 'user1',
    runQuery: vi.fn().mockResolvedValue(['doc123', 'doc456']),
    ...overrides,
  };
}

function createRagResponse(overrides?: Record<string, unknown>) {
  return {
    document_id: 'doc123',
    title: 'Test Document',
    content: 'Hello world',
    chunk_range: { start: 1, end: 5 },
    total_chunks: 10,
    total_chars: 11,
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
  mockFetchSuccess(createRagResponse());
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('retrieveDocument helper', () => {
  it('returns correct result shape on happy path', async () => {
    const ctx = createMockCtx();

    const result = await retrieveDocument(ctx as never, {
      documentId: 'doc123',
    });

    expect(result).toEqual({
      documentId: 'doc123',
      name: 'Test Document',
      content: 'Hello world',
      chunkRange: { start: 1, end: 5 },
      totalChunks: 10,
      truncated: false,
      totalChars: 11,
    });
  });

  it('forwards chunkStart and chunkEnd as query params', async () => {
    const ctx = createMockCtx();

    await retrieveDocument(ctx as never, {
      documentId: 'doc123',
      chunkStart: 5,
      chunkEnd: 15,
    });

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = fetchCall?.[0];
    expect(url).toContain('chunk_start=5');
    expect(url).toContain('chunk_end=15');
  });

  it('omits query params when chunkStart and chunkEnd not provided', async () => {
    const ctx = createMockCtx();

    await retrieveDocument(ctx as never, { documentId: 'doc123' });

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = fetchCall?.[0] ?? '';
    expect(url).not.toContain('chunk_start');
    expect(url).not.toContain('chunk_end');
    expect(url).toMatch(/\/content$/);
  });

  it('truncates content exceeding 50K chars', async () => {
    const longContent = 'x'.repeat(60_000);
    mockFetchSuccess(
      createRagResponse({ content: longContent, total_chars: 60_000 }),
    );
    const ctx = createMockCtx();

    const result = await retrieveDocument(ctx as never, {
      documentId: 'doc123',
    });

    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(50_000);
  });

  it('does not truncate content at exactly 50K chars', async () => {
    const exactContent = 'x'.repeat(50_000);
    mockFetchSuccess(
      createRagResponse({ content: exactContent, total_chars: 50_000 }),
    );
    const ctx = createMockCtx();

    const result = await retrieveDocument(ctx as never, {
      documentId: 'doc123',
    });

    expect(result.truncated).toBe(false);
    expect(result.content).toHaveLength(50_000);
  });

  it('throws when organizationId is missing', async () => {
    const ctx = createMockCtx({ organizationId: undefined });

    await expect(
      retrieveDocument(ctx as never, { documentId: 'doc123' }),
    ).rejects.toThrow('organizationId is required');
  });

  it('throws when userId is missing', async () => {
    const ctx = createMockCtx({ userId: undefined });

    await expect(
      retrieveDocument(ctx as never, { documentId: 'doc123' }),
    ).rejects.toThrow('userId is required');
  });

  it('throws when document is not in accessible IDs', async () => {
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(['other-doc']),
    });

    await expect(
      retrieveDocument(ctx as never, { documentId: 'doc123' }),
    ).rejects.toThrow('Document not found or access denied');
  });

  it('throws graceful message on RAG 404', async () => {
    globalThis.fetch = Object.assign(
      vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })),
      { preconnect: vi.fn() },
    );
    const ctx = createMockCtx();

    await expect(
      retrieveDocument(ctx as never, { documentId: 'doc123' }),
    ).rejects.toThrow('was not found in the knowledge base');
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
    const ctx = createMockCtx();

    await expect(
      retrieveDocument(ctx as never, { documentId: 'doc123' }),
    ).rejects.toThrow('RAG service error (500)');
  });

  it('wraps non-JSON response parse error', async () => {
    globalThis.fetch = Object.assign(
      vi.fn().mockResolvedValue(
        new Response('<html>Error</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
      { preconnect: vi.fn() },
    );
    const ctx = createMockCtx();

    await expect(
      retrieveDocument(ctx as never, { documentId: 'doc123' }),
    ).rejects.toThrow('Failed to parse RAG response');
  });

  it('handles empty content from RAG gracefully', async () => {
    mockFetchSuccess(createRagResponse({ content: '', total_chars: 0 }));
    const ctx = createMockCtx();

    const result = await retrieveDocument(ctx as never, {
      documentId: 'doc123',
    });

    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
  });

  it('uses encodeURIComponent for documentId in URL', async () => {
    const ctx = createMockCtx({
      runQuery: vi.fn().mockResolvedValue(['doc/with/slashes']),
    });

    await retrieveDocument(ctx as never, {
      documentId: 'doc/with/slashes',
    });

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = fetchCall?.[0] ?? '';
    expect(url).toContain('doc%2Fwith%2Fslashes');
    expect(url).not.toContain('doc/with/slashes/content');
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
    const ctx = createMockCtx();

    await expect(
      retrieveDocument(ctx as never, { documentId: 'doc123' }),
    ).rejects.toThrow('timed out after 60s');
  });

  it('re-throws network errors from fetch', async () => {
    globalThis.fetch = Object.assign(
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      { preconnect: vi.fn() },
    );
    const ctx = createMockCtx();

    await expect(
      retrieveDocument(ctx as never, { documentId: 'doc123' }),
    ).rejects.toThrow('Failed to fetch');
  });

  it('returns "Untitled" when RAG response has null title', async () => {
    mockFetchSuccess(createRagResponse({ title: null }));
    const ctx = createMockCtx();

    const result = await retrieveDocument(ctx as never, {
      documentId: 'doc123',
    });

    expect(result.name).toBe('Untitled');
  });
});

describe('documentRetrieveArgs schema validation', () => {
  it('accepts valid documentId only', () => {
    const result = documentRetrieveArgs.parse({ documentId: 'abc123' });
    expect(result.documentId).toBe('abc123');
    expect(result.chunkStart).toBeUndefined();
    expect(result.chunkEnd).toBeUndefined();
  });

  it('accepts documentId with chunkStart and chunkEnd', () => {
    const result = documentRetrieveArgs.parse({
      documentId: 'abc123',
      chunkStart: 1,
      chunkEnd: 10,
    });
    expect(result.chunkStart).toBe(1);
    expect(result.chunkEnd).toBe(10);
  });

  it('rejects empty documentId', () => {
    expect(() => documentRetrieveArgs.parse({ documentId: '' })).toThrow();
  });

  it('rejects chunkStart below 1', () => {
    expect(() =>
      documentRetrieveArgs.parse({ documentId: 'abc', chunkStart: 0 }),
    ).toThrow();
  });

  it('rejects chunkEnd below 1', () => {
    expect(() =>
      documentRetrieveArgs.parse({ documentId: 'abc', chunkEnd: 0 }),
    ).toThrow();
  });

  it('rejects non-integer chunkStart', () => {
    expect(() =>
      documentRetrieveArgs.parse({ documentId: 'abc', chunkStart: 1.5 }),
    ).toThrow();
  });

  it('rejects chunkStart greater than chunkEnd', () => {
    expect(() =>
      documentRetrieveArgs.parse({
        documentId: 'abc',
        chunkStart: 10,
        chunkEnd: 5,
      }),
    ).toThrow();
  });

  it('rejects chunk range exceeding 100', () => {
    expect(() =>
      documentRetrieveArgs.parse({
        documentId: 'abc',
        chunkStart: 1,
        chunkEnd: 200,
      }),
    ).toThrow();
  });

  it('accepts chunkStart without chunkEnd', () => {
    const result = documentRetrieveArgs.parse({
      documentId: 'abc',
      chunkStart: 5,
    });
    expect(result.chunkStart).toBe(5);
    expect(result.chunkEnd).toBeUndefined();
  });

  it('accepts chunkEnd without chunkStart', () => {
    const result = documentRetrieveArgs.parse({
      documentId: 'abc',
      chunkEnd: 10,
    });
    expect(result.chunkEnd).toBe(10);
    expect(result.chunkStart).toBeUndefined();
  });
});
