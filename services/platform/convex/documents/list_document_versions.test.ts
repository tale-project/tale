import { describe, expect, it, vi } from 'vitest';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { listDocumentVersionsForDoc } from './list_document_versions';

function createMockCtx(
  metaByStorage: Record<
    string,
    {
      _creationTime: number;
      fileName: string;
      size: number;
      contentType: string;
    }
  >,
) {
  return {
    db: {
      query: vi.fn().mockImplementation(() => {
        let storageFilter: string | undefined;
        const builder = {
          withIndex: vi
            .fn()
            .mockImplementation(
              (
                _name: string,
                cb: (q: { eq: (f: string, v: unknown) => unknown }) => void,
              ) => {
                const qb = {
                  eq: vi
                    .fn()
                    .mockImplementation((field: string, value: unknown) => {
                      if (field === 'storageId')
                        storageFilter = value as string;
                      return qb;
                    }),
                };
                cb(qb);
                return builder;
              },
            ),
          first: vi.fn().mockImplementation(() => {
            if (!storageFilter) return Promise.resolve(null);
            const row = metaByStorage[storageFilter];
            return Promise.resolve(
              row
                ? { storageId: storageFilter, organizationId: 'org1', ...row }
                : null,
            );
          }),
        };
        return builder;
      }),
    },
  } as unknown as QueryCtx;
}

describe('listDocumentVersionsForDoc', () => {
  it('returns current first, then history newest-previous to oldest', async () => {
    const ctx = createMockCtx({
      storage_current: {
        _creationTime: 300,
        fileName: 'transform.py',
        size: 100,
        contentType: 'text/x-python',
      },
      storage_mid: {
        _creationTime: 200,
        fileName: 'transform.py',
        size: 90,
        contentType: 'text/x-python',
      },
      storage_old: {
        _creationTime: 100,
        fileName: 'transform.py',
        size: 80,
        contentType: 'text/x-python',
      },
    });

    const doc = {
      _id: 'doc1' as Id<'documents'>,
      _creationTime: 50,
      organizationId: 'org1',
      fileId: 'storage_current' as Id<'_storage'>,
      historyFiles: ['storage_old', 'storage_mid'],
      title: 'transform.py',
    } as Doc<'documents'>;

    const versions = await listDocumentVersionsForDoc(ctx, doc);
    expect(versions.map((v) => v.storageId)).toEqual([
      'storage_current',
      'storage_mid',
      'storage_old',
    ]);
    expect(versions[0]?.isCurrent).toBe(true);
    expect(versions[1]?.isCurrent).toBe(false);
    expect(versions[0]?.createdAt).toBe(300);
    expect(versions[2]?.createdAt).toBe(100);
  });

  it('falls back to document _creationTime when fileMetadata is missing', async () => {
    const ctx = createMockCtx({});
    const doc = {
      _id: 'doc1' as Id<'documents'>,
      _creationTime: 42,
      organizationId: 'org1',
      fileId: 'storage_only' as Id<'_storage'>,
      title: 'profile.yaml',
    } as Doc<'documents'>;

    const versions = await listDocumentVersionsForDoc(ctx, doc);
    expect(versions).toEqual([
      {
        storageId: 'storage_only',
        createdAt: 42,
        isCurrent: true,
        fileName: undefined,
        size: undefined,
        contentType: undefined,
      },
    ]);
  });

  it('dedupes when history accidentally includes the current fileId', async () => {
    const ctx = createMockCtx({
      storage_a: {
        _creationTime: 2,
        fileName: 'a.py',
        size: 1,
        contentType: 'text/plain',
      },
    });
    const doc = {
      _id: 'doc1' as Id<'documents'>,
      _creationTime: 1,
      organizationId: 'org1',
      fileId: 'storage_a' as Id<'_storage'>,
      historyFiles: ['storage_a'],
    } as Doc<'documents'>;

    const versions = await listDocumentVersionsForDoc(ctx, doc);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.isCurrent).toBe(true);
  });
});
