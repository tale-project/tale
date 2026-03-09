import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadFile } from './upload_file_direct';

const RAG_URL = 'http://rag:8000';
const FILE_ID = 'doc-abc-123';

function defaultArgs() {
  return {
    ragServiceUrl: RAG_URL,
    file: new Blob(['test-content'], { type: 'text/plain' }),
    filename: 'test.txt',
    contentType: 'text/plain',
    fileId: FILE_ID,
  };
}

describe('uploadFile', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchOk(body: object = {}) {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          success: true,
          document_id: 'rag-doc-1',
          chunks_created: 5,
          ...body,
        }),
    });
  }

  function mockFetchError(status: number, statusText: string, body = '') {
    fetchSpy.mockResolvedValue({
      ok: false,
      status,
      statusText,
      text: () => Promise.resolve(body),
    });
  }

  function getCalledFormData(): FormData {
    return fetchSpy.mock.calls[0][1].body;
  }

  it('sends multipart form data with correct filename', async () => {
    mockFetchOk();

    await uploadFile(defaultArgs());

    const formData = getCalledFormData();
    const file = formData.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('test.txt');
  });

  it('includes document_id in form data', async () => {
    mockFetchOk();

    await uploadFile(defaultArgs());

    const formData = getCalledFormData();
    expect(formData.get('document_id')).toBe(FILE_ID);
  });

  it('includes metadata with content_type in form data', async () => {
    mockFetchOk();

    await uploadFile(defaultArgs());

    const formData = getCalledFormData();
    const metadata = JSON.parse(formData.get('metadata') as string);
    expect(metadata.content_type).toBe('text/plain');
  });

  it('merges custom metadata with content_type', async () => {
    mockFetchOk();

    await uploadFile({
      ...defaultArgs(),
      metadata: { source: 'upload', category: 'legal' },
    });

    const formData = getCalledFormData();
    const metadata = JSON.parse(formData.get('metadata') as string);
    expect(metadata.content_type).toBe('text/plain');
    expect(metadata.source).toBe('upload');
    expect(metadata.category).toBe('legal');
  });

  it('appends ?sync=true to URL when sync is true', async () => {
    mockFetchOk();

    await uploadFile({ ...defaultArgs(), sync: true });

    const calledUrl: string = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toBe(`${RAG_URL}/api/v1/documents/upload?sync=true`);
  });

  it('does not append ?sync=true when sync is false', async () => {
    mockFetchOk();

    await uploadFile({ ...defaultArgs(), sync: false });

    const calledUrl: string = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toBe(`${RAG_URL}/api/v1/documents/upload`);
  });

  it('does not append ?sync=true when sync is omitted', async () => {
    mockFetchOk();

    await uploadFile(defaultArgs());

    const calledUrl: string = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toBe(`${RAG_URL}/api/v1/documents/upload`);
  });

  it('throws on non-ok response with status info', async () => {
    mockFetchError(500, 'Internal Server Error', 'something broke');

    await expect(uploadFile(defaultArgs())).rejects.toThrow(
      'RAG service error: 500 Internal Server Error - something broke',
    );
  });

  it('throws on non-ok response without body', async () => {
    mockFetchError(502, 'Bad Gateway');

    await expect(uploadFile(defaultArgs())).rejects.toThrow(
      'RAG service error: 502 Bad Gateway',
    );
  });

  it('returns correct RagUploadResult shape on success', async () => {
    mockFetchOk({
      success: true,
      document_id: 'rag-doc-42',
      chunks_created: 7,
    });

    const result = await uploadFile(defaultArgs());

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        fileId: FILE_ID,
        ragDocumentId: 'rag-doc-42',
        chunksCreated: 7,
      }),
    );
    expect(result.processingTimeMs).toBeTypeOf('number');
    expect(result.timestamp).toBeTypeOf('number');
  });

  it('uses id field as fallback when document_id is absent', async () => {
    mockFetchOk({ document_id: undefined, id: 'fallback-id' });

    const result = await uploadFile(defaultArgs());

    expect(result.ragDocumentId).toBe('fallback-id');
  });

  it('defaults chunksCreated to 0 when not in response', async () => {
    mockFetchOk({ chunks_created: undefined });

    const result = await uploadFile(defaultArgs());

    expect(result.chunksCreated).toBe(0);
  });

  it('defaults success to true when not in response', async () => {
    mockFetchOk({ success: undefined });

    const result = await uploadFile(defaultArgs());

    expect(result.success).toBe(true);
  });

  it('sends POST method', async () => {
    mockFetchOk();

    await uploadFile(defaultArgs());

    expect(fetchSpy.mock.calls[0][1].method).toBe('POST');
  });

  it('passes abort signal for timeout', async () => {
    mockFetchOk();

    await uploadFile(defaultArgs());

    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
