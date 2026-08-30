import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../lib/rows';
import {
  importFiles,
  type ImportFilesDependencies,
  type ImportItem,
} from './import_files';

function makeDeps(overrides: Partial<ImportFilesDependencies> = {}) {
  const createDocument = vi.fn().mockResolvedValue('doc-1');
  const deps = {
    getFileMetadata: vi
      .fn()
      .mockResolvedValue({ success: true, data: { hash: undefined } }),
    downloadToStorage: vi.fn().mockResolvedValue({
      success: true,
      storageId: 'storage-1' as Id<'_storage'>,
      mimeType: 'text/plain',
      size: 10,
    }),
    findDocumentByExternalId: vi.fn().mockResolvedValue(null),
    createDocument,
    updateDocument: vi.fn().mockResolvedValue(undefined),
    getOrCreateFolderPath: vi.fn().mockResolvedValue('folder-row-1'),
    saveFileMetadata: vi.fn().mockResolvedValue(undefined),
    linkDocumentToFile: vi.fn().mockResolvedValue(undefined),
    scheduleHubDocumentRagIndexing: vi.fn().mockResolvedValue(undefined),
    upsertSyncConfig: vi.fn().mockResolvedValue('cfg-1'),
  };
  return {
    ...deps,
    ...overrides,
    createDocument: overrides.createDocument ?? createDocument,
  };
}

const folderItems: ImportItem[] = [
  {
    id: 'file-a',
    name: 'a.docx',
    size: 10,
    relativePath: 'Meetings/a.docx',
    isDirectlySelected: false,
    selectedParentId: 'folder-meetings',
    selectedParentName: 'Meetings',
    selectedParentPath: 'Meetings',
  },
];

const baseArgs = {
  organizationId: 'org-1',
  token: 'tok',
  userId: 'user-1',
};

describe('importFiles sync configs', () => {
  it('registers a sync config per selected folder on sync import', async () => {
    const deps = makeDeps();

    const result = await importFiles(
      { ...baseArgs, items: folderItems, importType: 'sync' },
      deps,
    );

    expect(result.success).toBe(true);
    expect(deps.upsertSyncConfig).toHaveBeenCalledTimes(1);
    expect(deps.upsertSyncConfig).toHaveBeenCalledWith({
      itemType: 'folder',
      itemId: 'folder-meetings',
      itemName: 'Meetings',
      itemPath: 'Meetings',
      organizationId: 'org-1',
      userId: 'user-1',
      teamId: undefined,
      targetBucket: 'documents',
      storagePrefix: 'org-1/Meetings',
    });

    // The document must point back at its config so later sync runs can
    // update and prune it.
    const metadata = vi.mocked(deps.createDocument).mock.calls[0][0].metadata;
    expect(metadata.syncConfigId).toBe('cfg-1');
    expect(metadata.sourceMode).toBe('auto');
  });

  it('creates no sync config on one-time import', async () => {
    const deps = makeDeps();

    await importFiles(
      { ...baseArgs, items: folderItems, importType: 'one-time' },
      deps,
    );

    expect(deps.upsertSyncConfig).not.toHaveBeenCalled();
    const metadata = vi.mocked(deps.createDocument).mock.calls[0][0].metadata;
    expect(metadata.syncConfigId).toBeUndefined();
    expect(metadata.sourceMode).toBe('manual');
  });

  it('recreates the folder chain from relativePath', async () => {
    const deps = makeDeps();

    await importFiles(
      { ...baseArgs, items: folderItems, importType: 'one-time' },
      deps,
    );

    expect(deps.getOrCreateFolderPath).toHaveBeenCalledWith(
      'org-1',
      ['Meetings'],
      'user-1',
      undefined,
    );
    expect(vi.mocked(deps.createDocument).mock.calls[0][0].folderId).toBe(
      'folder-row-1',
    );
  });

  it('queues RAG indexing after the document is linked', async () => {
    const deps = makeDeps();

    await importFiles(
      { ...baseArgs, items: folderItems, importType: 'one-time' },
      deps,
    );

    expect(deps.saveFileMetadata).toHaveBeenCalledWith(
      'storage-1',
      'a.docx',
      'text/plain',
      10,
      'doc-1',
    );
    expect(deps.linkDocumentToFile).toHaveBeenCalledWith('storage-1', 'doc-1');
    expect(deps.scheduleHubDocumentRagIndexing).toHaveBeenCalledWith('doc-1');
  });

  it('records the transferred byte size, falling back to the listing size', async () => {
    // stored.size (from the download Content-Length) wins over the listing size.
    const deps = makeDeps({
      downloadToStorage: vi.fn().mockResolvedValue({
        success: true,
        storageId: 'storage-1' as Id<'_storage'>,
        mimeType: 'text/plain',
        size: 4096,
      }),
    });
    await importFiles(
      { ...baseArgs, items: folderItems, importType: 'one-time' },
      deps,
    );
    expect(deps.saveFileMetadata).toHaveBeenCalledWith(
      'storage-1',
      'a.docx',
      'text/plain',
      4096,
      'doc-1',
    );

    // When the source omits Content-Length, fall back to the listing size (10).
    const depsNoSize = makeDeps({
      downloadToStorage: vi.fn().mockResolvedValue({
        success: true,
        storageId: 'storage-1' as Id<'_storage'>,
        mimeType: 'text/plain',
      }),
    });
    await importFiles(
      { ...baseArgs, items: folderItems, importType: 'one-time' },
      depsNoSize,
    );
    expect(depsNoSize.saveFileMetadata).toHaveBeenCalledWith(
      'storage-1',
      'a.docx',
      'text/plain',
      10,
      'doc-1',
    );
  });

  it('fills the size from the Graph item metadata when the listing omits it', async () => {
    // A recursive listing can omit `size` for a freshly copied/uploaded item,
    // and the download may arrive without a Content-Length. The Graph
    // item-metadata size then fills both the stored file size and the row's
    // metadata.size so the hub never renders it as "—".
    const deps = makeDeps({
      getFileMetadata: vi.fn().mockResolvedValue({
        success: true,
        data: { hash: undefined, size: 2048 },
      }),
      downloadToStorage: vi.fn().mockResolvedValue({
        success: true,
        storageId: 'storage-1' as Id<'_storage'>,
        mimeType: 'text/plain',
        // no `size`: source omitted Content-Length
      }),
    });

    const itemNoSize: ImportItem = {
      ...folderItems[0],
      size: undefined as unknown as number,
    };
    await importFiles(
      { ...baseArgs, items: [itemNoSize], importType: 'sync' },
      deps,
    );

    const metadata = vi.mocked(deps.createDocument).mock.calls[0][0].metadata;
    expect(metadata.size).toBe(2048);
    expect(deps.saveFileMetadata).toHaveBeenCalledWith(
      'storage-1',
      'a.docx',
      'text/plain',
      2048,
      'doc-1',
    );
  });

  it('fails the item when the streamed download+store fails', async () => {
    const deps = makeDeps({
      downloadToStorage: vi
        .fn()
        .mockResolvedValue({ success: false, error: 'boom' }),
    });
    const result = await importFiles(
      { ...baseArgs, items: folderItems, importType: 'one-time' },
      deps,
    );
    expect(result.failedCount).toBe(1);
    expect(result.results[0]).toMatchObject({ status: 'error', error: 'boom' });
    expect(deps.createDocument).not.toHaveBeenCalled();
  });

  it('still queues indexing when content hash is unchanged', async () => {
    const deps = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue({
        _id: 'doc-existing',
        contentHash: 'same-hash',
      }),
      getFileMetadata: vi
        .fn()
        .mockResolvedValue({ success: true, data: { hash: 'same-hash' } }),
    });

    const result = await importFiles(
      { ...baseArgs, items: folderItems, importType: 'sync' },
      deps,
    );

    expect(result.skippedCount).toBe(1);
    expect(deps.scheduleHubDocumentRagIndexing).toHaveBeenCalledWith(
      'doc-existing',
    );
    expect(deps.downloadToStorage).not.toHaveBeenCalled();
  });
});
