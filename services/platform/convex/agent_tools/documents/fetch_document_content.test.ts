import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { _resetRagConfigForTests } from '../../lib/helpers/rag_config';
import { fetchDocumentContent } from './helpers/fetch_document_content';

const RAG_URL = 'http://mock-rag:8001';

beforeAll(() => {
  process.env.RAG_URL = RAG_URL;
  process.env.RAG_AUTH_TOKEN = 'test-token';
  _resetRagConfigForTests();
});
const FILE_ID = 'file-storage-123';

const originalFetch = globalThis.fetch;

function createRagResponse(overrides?: Record<string, unknown>) {
  return {
    file_id: FILE_ID,
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

describe('fetchDocumentContent', () => {
  it('returns correct result shape on happy path', async () => {
    const result = await fetchDocumentContent(FILE_ID);

    expect(result).toEqual({
      fileId: FILE_ID,
      name: 'Test Document',
      content: 'Hello world',
      chunkRange: { start: 1, end: 5 },
      totalChunks: 10,
      truncated: false,
      totalChars: 11,
    });
  });

  it('builds URL without query params when no options provided', async () => {
    await fetchDocumentContent(FILE_ID);

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = fetchCall?.[0] ?? '';
    expect(url).toBe(`${RAG_URL}/api/v1/documents/${FILE_ID}/content`);
  });

  it('appends chunk_start and chunk_end query params', async () => {
    await fetchDocumentContent(FILE_ID, {
      chunkStart: 3,
      chunkEnd: 8,
    });

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = fetchCall?.[0] ?? '';
    expect(url).toContain('chunk_start=3');
    expect(url).toContain('chunk_end=8');
  });

  it('appends return_chunks=true when returnChunks is set', async () => {
    mockFetchSuccess(
      createRagResponse({
        chunks: [
          { index: 1, content: 'chunk 1' },
          { index: 2, content: 'chunk 2' },
        ],
      }),
    );

    const result = await fetchDocumentContent(FILE_ID, {
      returnChunks: true,
    });

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = fetchCall?.[0] ?? '';
    expect(url).toContain('return_chunks=true');
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks?.[0]).toEqual({ index: 1, content: 'chunk 1' });
  });

  it('omits return_chunks param when not set', async () => {
    await fetchDocumentContent(FILE_ID);

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = fetchCall?.[0] ?? '';
    expect(url).not.toContain('return_chunks');
  });

  it('encodes fileId in URL', async () => {
    await fetchDocumentContent('file/with spaces');

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = fetchCall?.[0] ?? '';
    expect(url).toContain('file%2Fwith%20spaces');
  });

  it('truncates content exceeding 50K chars', async () => {
    const longContent = 'x'.repeat(60_000);
    mockFetchSuccess(
      createRagResponse({ content: longContent, total_chars: 60_000 }),
    );

    const result = await fetchDocumentContent(FILE_ID);

    expect(result.truncated).toBe(true);
    expect(result.content).toHaveLength(50_000);
    expect(result.totalChars).toBe(60_000);
  });

  it('does not truncate content at exactly 50K chars', async () => {
    const exactContent = 'x'.repeat(50_000);
    mockFetchSuccess(
      createRagResponse({ content: exactContent, total_chars: 50_000 }),
    );

    const result = await fetchDocumentContent(FILE_ID);

    expect(result.truncated).toBe(false);
    expect(result.content).toHaveLength(50_000);
  });

  it('handles empty content', async () => {
    mockFetchSuccess(createRagResponse({ content: '', total_chars: 0 }));

    const result = await fetchDocumentContent(FILE_ID);

    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
    expect(result.totalChars).toBe(0);
  });

  it('handles null content as empty string', async () => {
    mockFetchSuccess(createRagResponse({ content: null, total_chars: 0 }));

    const result = await fetchDocumentContent(FILE_ID);

    expect(result.content).toBe('');
    expect(result.truncated).toBe(false);
  });

  it('returns "Untitled" when RAG title is null', async () => {
    mockFetchSuccess(createRagResponse({ title: null }));

    const result = await fetchDocumentContent(FILE_ID);

    expect(result.name).toBe('Untitled');
  });

  it('throws on RAG 404', async () => {
    globalThis.fetch = Object.assign(
      vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })),
      { preconnect: vi.fn() },
    );

    await expect(fetchDocumentContent(FILE_ID)).rejects.toThrow(
      'was not found in the knowledge base',
    );
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

    await expect(fetchDocumentContent(FILE_ID)).rejects.toThrow(
      'RAG service error (500)',
    );
  });

  it('includes error body text in non-ok error message', async () => {
    globalThis.fetch = Object.assign(
      vi.fn().mockResolvedValue(new Response('Rate limited', { status: 429 })),
      { preconnect: vi.fn() },
    );

    await expect(fetchDocumentContent(FILE_ID)).rejects.toThrow('Rate limited');
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

    await expect(fetchDocumentContent(FILE_ID)).rejects.toThrow(
      'Failed to parse RAG response',
    );
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

    await expect(fetchDocumentContent(FILE_ID)).rejects.toThrow(
      'timed out after 60s',
    );
  });

  it('re-throws network errors from fetch', async () => {
    globalThis.fetch = Object.assign(
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      { preconnect: vi.fn() },
    );

    await expect(fetchDocumentContent(FILE_ID)).rejects.toThrow(
      'Failed to fetch',
    );
  });

  it('passes AbortSignal to fetch', async () => {
    await fetchDocumentContent(FILE_ID);

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const options = fetchCall?.[1];
    expect(options).toHaveProperty('signal');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  });

  it('combines chunkStart with returnChunks in query params', async () => {
    mockFetchSuccess(
      createRagResponse({
        chunks: [{ index: 5, content: 'chunk 5' }],
      }),
    );

    await fetchDocumentContent(FILE_ID, {
      chunkStart: 5,
      returnChunks: true,
    });

    const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = fetchCall?.[0] ?? '';
    expect(url).toContain('chunk_start=5');
    expect(url).toContain('return_chunks=true');
    expect(url).not.toContain('chunk_end');
  });
});
