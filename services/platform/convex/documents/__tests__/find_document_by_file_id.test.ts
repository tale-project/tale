import { describe, expect, it, vi } from 'vitest';

import { findDocumentByFileId } from '../find_document_by_file_id';

function createMockCtx(result: unknown = null) {
  return {
    db: {
      query: vi.fn().mockReturnValue({
        withIndex: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(result),
        }),
      }),
    },
  };
}

describe('findDocumentByFileId', () => {
  it('returns document when found', async () => {
    const mockDoc = {
      _id: 'doc123',
      organizationId: 'org1',
      fileId: 'file-abc',
      title: 'Test Document',
    };
    const ctx = createMockCtx(mockDoc);

    const result = await findDocumentByFileId(ctx as never, {
      organizationId: 'org1',
      fileId: 'file-abc',
    });

    expect(result).toEqual(mockDoc);
    expect(ctx.db.query).toHaveBeenCalledWith('documents');
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
