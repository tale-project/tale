import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { deleteDocumentById } from './delete_document';

describe('deleteDocumentById', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function mockFetch(response: object, status = 200) {
    fetchSpy.mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(response),
      text: () => Promise.resolve(JSON.stringify(response)),
    });
  }

  function getCalledUrl(): URL {
    return new URL(fetchSpy.mock.calls[0][0]);
  }

  it('calls correct URL path', async () => {
    mockFetch({
      success: true,
      deleted_count: 1,
      deleted_data_ids: ['abc'],
      message: 'Deleted',
    });

    await deleteDocumentById({
      ragServiceUrl: 'http://rag:8000',
      documentId: 'doc-123',
    });

    const url = getCalledUrl();
    expect(url.pathname).toBe('/api/v1/documents/doc-123');
  });

  it('returns parsed result on success', async () => {
    mockFetch({
      success: true,
      deleted_count: 2,
      deleted_data_ids: ['id1', 'id2'],
      message: 'Deleted 2 docs',
      processing_time_ms: 42,
    });

    const result = await deleteDocumentById({
      ragServiceUrl: 'http://rag:8000',
      documentId: 'doc-abc',
    });

    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(2);
    expect(result.deletedDataIds).toEqual(['id1', 'id2']);
    expect(result.message).toBe('Deleted 2 docs');
  });

  it('returns error result on HTTP failure', async () => {
    mockFetch({ detail: 'not found' }, 400);

    const result = await deleteDocumentById({
      ragServiceUrl: 'http://rag:8000',
      documentId: 'doc-fail',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('400');
  });

  it('URL-encodes document IDs with special characters', async () => {
    mockFetch({ success: true, deleted_count: 0, deleted_data_ids: [] });

    await deleteDocumentById({
      ragServiceUrl: 'http://rag:8000',
      documentId: 'doc/with spaces',
    });

    expect(fetchSpy.mock.calls[0][0]).toContain('doc%2Fwith%20spaces');
  });
});
