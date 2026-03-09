import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./upload_file_direct', () => ({
  uploadFile: vi.fn(),
}));

vi.mock('../../../../lib/type_cast_helpers', () => ({
  toId: (s: string) => s,
}));

import { uploadDocument } from './upload_document';
import { uploadFile } from './upload_file_direct';

const uploadFileMock = vi.mocked(uploadFile);

const DEFAULT_METADATA = {
  fileName: 'document.pdf',
  contentType: 'application/pdf',
};

function createCtx(
  getUrlResult: string | null = 'https://storage.example.com/file',
  metadataResult: Record<string, unknown> | null = DEFAULT_METADATA,
) {
  return {
    storage: {
      getUrl: vi.fn().mockResolvedValue(getUrlResult),
    },
    runQuery: vi.fn().mockResolvedValue(metadataResult),
  };
}

const RAG_URL = 'http://rag:8000';
const FILE_ID = 'storage-id-123';

const UPLOAD_RESULT = {
  success: true,
  fileId: FILE_ID,
  ragDocumentId: 'rag-doc-1',
  chunksCreated: 3,
  processingTimeMs: 50,
  timestamp: 1000,
};

describe('uploadDocument', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    uploadFileMock.mockResolvedValue(UPLOAD_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetchOk(contentType?: string) {
    const blob = new Blob(['file-content']);
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(blob),
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-type' ? (contentType ?? null) : null,
      },
    });
  }

  it('calls ctx.storage.getUrl with the storageId', async () => {
    const ctx = createCtx();
    mockFetchOk();

    await uploadDocument(ctx as never, RAG_URL, FILE_ID);

    expect(ctx.storage.getUrl).toHaveBeenCalledWith(FILE_ID);
  });

  it('throws when storage.getUrl returns null', async () => {
    const ctx = createCtx(null);

    await expect(
      uploadDocument(ctx as never, RAG_URL, FILE_ID),
    ).rejects.toThrow(`File URL not available: ${FILE_ID}`);
  });

  it('throws when file download fails with non-ok response', async () => {
    const ctx = createCtx();
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
    });

    await expect(
      uploadDocument(ctx as never, RAG_URL, FILE_ID),
    ).rejects.toThrow('Failed to download file: 404');
  });

  it('throws when fileMetadata is not found', async () => {
    const ctx = createCtx('https://storage.example.com/file', null);
    mockFetchOk();

    await expect(
      uploadDocument(ctx as never, RAG_URL, FILE_ID),
    ).rejects.toThrow('File metadata not found');
  });

  it('uses fileName and contentType from fileMetadata', async () => {
    const ctx = createCtx('https://storage.example.com/file', {
      fileName: 'contract.docx',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    mockFetchOk();

    await uploadDocument(ctx as never, RAG_URL, FILE_ID);

    expect(uploadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'contract.docx',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );
  });

  it('options override fileMetadata values', async () => {
    const ctx = createCtx('https://storage.example.com/file', {
      fileName: 'contract.docx',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    mockFetchOk();

    await uploadDocument(ctx as never, RAG_URL, FILE_ID, {
      fileName: 'override.pdf',
      contentType: 'application/pdf',
    });

    expect(uploadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'override.pdf',
        contentType: 'application/pdf',
      }),
    );
  });

  it('derives extension from contentType when fileName has no extension', async () => {
    const ctx = createCtx('https://storage.example.com/file', {
      fileName: 'report',
      contentType: 'application/pdf',
    });
    mockFetchOk();

    await uploadDocument(ctx as never, RAG_URL, FILE_ID);

    expect(uploadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ filename: 'report.pdf' }),
    );
  });

  it('passes sync option through to uploadFile', async () => {
    const ctx = createCtx();
    mockFetchOk();

    await uploadDocument(ctx as never, RAG_URL, FILE_ID, { sync: true });

    expect(uploadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ sync: true }),
    );
  });

  it('defaults sync to false when not provided', async () => {
    const ctx = createCtx();
    mockFetchOk();

    await uploadDocument(ctx as never, RAG_URL, FILE_ID);

    expect(uploadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ sync: false }),
    );
  });

  it('passes ragServiceUrl and fileId to uploadFile', async () => {
    const ctx = createCtx();
    mockFetchOk();

    await uploadDocument(ctx as never, RAG_URL, FILE_ID);

    expect(uploadFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ragServiceUrl: RAG_URL,
        fileId: FILE_ID,
      }),
    );
  });

  it('passes the downloaded blob as file to uploadFile', async () => {
    const ctx = createCtx();
    mockFetchOk();

    await uploadDocument(ctx as never, RAG_URL, FILE_ID);

    const callArgs = uploadFileMock.mock.calls[0][0];
    expect(callArgs.file).toBeInstanceOf(Blob);
  });
});
