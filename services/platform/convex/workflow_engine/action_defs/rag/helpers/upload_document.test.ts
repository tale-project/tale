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
  organizationId: 'org-1',
};

const DEFAULT_ORG_ROW = { _id: 'org-1', slug: 'default' };

/**
 * `uploadDocument` no longer downloads the file into a Blob — the in-process
 * `uploadFile` indexer reads bytes straight from storage by `fileId`. So the
 * ctx only needs `runQuery` (metadata + org-slug lookups); `storage` is a stub
 * the helper never calls. `uploadFile` is now invoked as `uploadFile(ctx, args)`
 * — assertions read the SECOND positional arg.
 */
function createCtx(metadataResult: Record<string, unknown> | null) {
  // uploadDocument issues two runQuery calls in order:
  //   1. internal.file_metadata.internal_queries.getByStorageId
  //   2. components.betterAuth.adapter.findOne (via orgSlugFromId)
  return {
    storage: { getUrl: vi.fn(), get: vi.fn() },
    runQuery: vi
      .fn()
      .mockResolvedValueOnce(metadataResult)
      .mockResolvedValueOnce(DEFAULT_ORG_ROW),
  };
}

const FILE_ID = 'storage-id-123';

const UPLOAD_RESULT = {
  success: true,
  fileId: FILE_ID,
  ragDocumentId: 'rag-doc-1',
  chunksCreated: 3,
  processingTimeMs: 50,
  timestamp: 1000,
};

/** The args object `uploadFile` was called with (second positional param). */
function uploadFileArgs(call = 0) {
  return uploadFileMock.mock.calls[call][1];
}

describe('uploadDocument', () => {
  beforeEach(() => {
    uploadFileMock.mockResolvedValue(UPLOAD_RESULT);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    uploadFileMock.mockReset();
  });

  it('throws when fileMetadata is not found', async () => {
    const ctx = createCtx(null);

    await expect(uploadDocument(ctx as never, FILE_ID)).rejects.toThrow(
      'File metadata not found',
    );
  });

  it('passes ctx as the first uploadFile arg', async () => {
    const ctx = createCtx(DEFAULT_METADATA);

    await uploadDocument(ctx as never, FILE_ID);

    expect(uploadFileMock.mock.calls[0][0]).toBe(ctx);
  });

  it('uses fileName and contentType from fileMetadata', async () => {
    const ctx = createCtx({
      fileName: 'contract.docx',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      organizationId: 'org-1',
    });

    await uploadDocument(ctx as never, FILE_ID);

    expect(uploadFileArgs()).toMatchObject({
      filename: 'contract.docx',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  });

  it('options override fileMetadata values', async () => {
    const ctx = createCtx({
      fileName: 'contract.docx',
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      organizationId: 'org-1',
    });

    await uploadDocument(ctx as never, FILE_ID, {
      fileName: 'override.pdf',
      contentType: 'application/pdf',
    });

    expect(uploadFileArgs()).toMatchObject({
      filename: 'override.pdf',
      contentType: 'application/pdf',
    });
  });

  it('derives extension from contentType when fileName has no extension', async () => {
    const ctx = createCtx({
      fileName: 'report',
      contentType: 'application/pdf',
      organizationId: 'org-1',
    });

    await uploadDocument(ctx as never, FILE_ID);

    expect(uploadFileArgs()).toMatchObject({ filename: 'report.pdf' });
  });

  it('passes sync option through to uploadFile', async () => {
    const ctx = createCtx(DEFAULT_METADATA);

    await uploadDocument(ctx as never, FILE_ID, { sync: true });

    expect(uploadFileArgs()).toMatchObject({ sync: true });
  });

  it('defaults sync to false when not provided', async () => {
    const ctx = createCtx(DEFAULT_METADATA);

    await uploadDocument(ctx as never, FILE_ID);

    expect(uploadFileArgs()).toMatchObject({ sync: false });
  });

  it('passes fileId to uploadFile', async () => {
    const ctx = createCtx(DEFAULT_METADATA);

    await uploadDocument(ctx as never, FILE_ID);

    expect(uploadFileArgs()).toMatchObject({ fileId: FILE_ID });
  });

  it('does not pass inline content (the indexer reads bytes from storage)', async () => {
    const ctx = createCtx(DEFAULT_METADATA);

    await uploadDocument(ctx as never, FILE_ID);

    // No inline `content` Blob — bytes are read from storage by fileId.
    expect(uploadFileArgs().content).toBeUndefined();
  });

  describe('folder path and metadata resolution', () => {
    function createLinkedDocCtx(document: Record<string, unknown> | null) {
      // runQuery order: getByStorageId → getDocumentByIdRaw → org row.
      return {
        storage: { getUrl: vi.fn(), get: vi.fn() },
        runQuery: vi
          .fn()
          .mockResolvedValueOnce({ ...DEFAULT_METADATA, documentId: 'doc-1' })
          .mockResolvedValueOnce(document)
          .mockResolvedValueOnce(DEFAULT_ORG_ROW),
      };
    }

    it('resolves folder_path from the linked Hub document', async () => {
      const ctx = createLinkedDocCtx({ folderPath: 'contracts/2024' });

      await uploadDocument(ctx as never, FILE_ID);

      expect(uploadFileArgs().metadata).toMatchObject({
        folder_path: 'contracts/2024',
      });
    });

    it('explicit folderPath option wins over the document folderPath', async () => {
      const ctx = createLinkedDocCtx({ folderPath: 'contracts/2024' });

      await uploadDocument(ctx as never, FILE_ID, { folderPath: '/reports/' });

      expect(uploadFileArgs().metadata).toMatchObject({
        folder_path: 'reports',
      });
    });

    it('stamps team_id, source_provider, and extension from the Hub document', async () => {
      const ctx = createLinkedDocCtx({
        folderPath: 'contracts',
        teamId: 'team-7',
        sourceProvider: 'onedrive',
        extension: 'docx',
      });

      await uploadDocument(ctx as never, FILE_ID);

      expect(uploadFileArgs().metadata).toEqual({
        folder_path: 'contracts',
        team_id: 'team-7',
        source_provider: 'onedrive',
        extension: 'docx',
      });
    });

    it('derives extension from the filename when the file has no linked document', async () => {
      const ctx = createCtx(DEFAULT_METADATA);

      await uploadDocument(ctx as never, FILE_ID);

      expect(uploadFileArgs().metadata).toEqual({ extension: 'pdf' });
    });

    it('omits folder_path and team fields when the linked document has none', async () => {
      const ctx = createLinkedDocCtx({ folderPath: undefined });

      await uploadDocument(ctx as never, FILE_ID);

      expect(uploadFileArgs().metadata).toEqual({ extension: 'pdf' });
    });
  });
});
