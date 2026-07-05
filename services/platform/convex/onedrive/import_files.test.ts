import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../_generated/dataModel';
import {
  importFiles,
  type ImportFilesDependencies,
  type ImportItem,
} from './import_files';

function makeDeps(overrides: Partial<ImportFilesDependencies> = {}) {
  const createDocument = vi.fn().mockResolvedValue('doc-1' as Id<'documents'>);
  const deps = {
    getFileMetadata: vi
      .fn()
      .mockResolvedValue({ success: true, data: { hash: undefined } }),
    downloadFile: vi.fn().mockResolvedValue({
      success: true,
      content: new ArrayBuffer(8),
      mimeType: 'text/plain',
    }),
    findDocumentByExternalId: vi.fn().mockResolvedValue(null),
    storeFile: vi.fn().mockResolvedValue('storage-1' as Id<'_storage'>),
    createDocument,
    updateDocument: vi.fn().mockResolvedValue(undefined),
    getOrCreateFolderPath: vi
      .fn()
      .mockResolvedValue('folder-row-1' as Id<'folders'>),
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
      8,
      'doc-1',
    );
    expect(deps.linkDocumentToFile).toHaveBeenCalledWith('storage-1', 'doc-1');
    expect(deps.scheduleHubDocumentRagIndexing).toHaveBeenCalledWith('doc-1');
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
    expect(deps.downloadFile).not.toHaveBeenCalled();
  });
});
