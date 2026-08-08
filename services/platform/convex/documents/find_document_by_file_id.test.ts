import { describe, expect, it, vi } from 'vitest';

import { findDocumentByFileId } from './find_document_by_file_id';

function createMockCtx(document: unknown = null, metadata: unknown = null) {
  return {
    db: {
      query: vi.fn((table: string) => ({
        withIndex: vi.fn().mockReturnValue({
          first: vi
            .fn()
            .mockResolvedValue(table === 'documents' ? document : metadata),
        }),
      })),
    },
  };
}

describe('findDocumentByFileId', () => {
  it('returns a current document with completed metadata', async () => {
    const mockDoc = {
      _id: 'doc123',
      organizationId: 'org1',
      fileId: 'file-abc',
      title: 'Test Document',
    };
    const ctx = createMockCtx(mockDoc, {
      _id: 'metadata123',
      organizationId: 'org1',
      storageId: 'file-abc',
      documentId: 'doc123',
      ragStatus: 'completed',
    });

    const result = await findDocumentByFileId(ctx as never, {
      organizationId: 'org1',
      fileId: 'file-abc',
    });

    expect(result).toEqual(mockDoc);
    expect(ctx.db.query).toHaveBeenCalledWith('documents');
  });

  it('fails closed while the matching file is not completed', async () => {
    const ctx = createMockCtx(
      {
        _id: 'doc123',
        organizationId: 'org1',
        fileId: 'file-abc',
      },
      {
        _id: 'metadata123',
        organizationId: 'org1',
        storageId: 'file-abc',
        documentId: 'doc123',
        ragStatus: 'running',
      },
    );

    const result = await findDocumentByFileId(ctx as never, {
      organizationId: 'org1',
      fileId: 'file-abc',
    });

    expect(result).toBeNull();
  });

  it('fails closed for stale metadata bound to a different document', async () => {
    const ctx = createMockCtx(
      {
        _id: 'doc123',
        organizationId: 'org1',
        fileId: 'file-abc',
      },
      {
        _id: 'metadata123',
        organizationId: 'org1',
        storageId: 'file-abc',
        documentId: 'doc456',
        ragStatus: 'completed',
      },
    );

    const result = await findDocumentByFileId(ctx as never, {
      organizationId: 'org1',
      fileId: 'file-abc',
    });

    expect(result).toBeNull();
  });

  it('returns null when no document matches', async () => {
    const ctx = createMockCtx(null);

    const result = await findDocumentByFileId(ctx as never, {
      organizationId: 'org1',
      fileId: 'nonexistent',
    });

    expect(result).toBeNull();
  });

  it('uses the correct index', async () => {
    const mockFirst = vi.fn().mockResolvedValue(null);
    const mockWithIndex = vi.fn().mockReturnValue({ first: mockFirst });
    const ctx = {
      db: {
        query: vi.fn().mockReturnValue({ withIndex: mockWithIndex }),
      },
    };

    await findDocumentByFileId(ctx as never, {
      organizationId: 'org1',
      fileId: 'file-abc',
    });

    expect(mockWithIndex).toHaveBeenCalledWith(
      'by_organizationId_and_fileId',
      expect.any(Function),
    );
  });
});
