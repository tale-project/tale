import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from 'vitest';

import { _resetRagConfigForTests } from '../../../../lib/helpers/rag_config';
import { deleteDocumentById } from './delete_document';

beforeAll(() => {
  process.env.RAG_URL = 'http://rag:8000';
  process.env.RAG_AUTH_TOKEN = 'test-token';
  _resetRagConfigForTests();
});

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
      fileId: 'doc-123',
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
      fileId: 'doc-abc',
    });

    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(2);
    expect(result.deletedDataIds).toEqual(['id1', 'id2']);
    expect(result.message).toBe('Deleted 2 docs');
  });

  it('returns error result on HTTP failure', async () => {
    mockFetch({ detail: 'service error' }, 500);

    const result = await deleteDocumentById({
      fileId: 'doc-fail',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
  });

  // Round-2 review HIGH (E.4.2): retention re-runs and cascade RAG
  // purges must be idempotent. A 404 ("already deleted") needs to be
  // a successful no-op, not a permanent failure indicator on the
  // retention receipt. Pre-fix, the test asserted 400 was an error —
  // but real RAG returns 404 for not-found, and the helper rethrew it
  // as a generic failure.
  it('treats 404 as a successful no-op for idempotency', async () => {
    mockFetch({ detail: 'not found' }, 404);

    const result = await deleteDocumentById({
      fileId: 'doc-already-gone',
    });

    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(0);
    expect(result.message).toBe('already_deleted');
    expect(result.error).toBeUndefined();
  });

  it('URL-encodes file IDs with special characters', async () => {
    mockFetch({ success: true, deleted_count: 0, deleted_data_ids: [] });

    await deleteDocumentById({
      fileId: 'doc/with spaces',
    });

    expect(fetchSpy.mock.calls[0][0]).toContain('doc%2Fwith%20spaces');
  });
});
