import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../lib/rows';
import {
  importFiles,
  type ImportFilesDependencies,
  type ImportItem,
} from './import_files';

// The stored type is resolved from the file name's extension first — a
// declared `text/plain` on `a.docx` is the source's claim, not the file's
// type (2026-09-14 evaluation, g3-3).
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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

describe('SharePoint import modes', () => {
  const sharePointItem: ImportItem = {
    id: 'report',
    name: 'Report.txt',
    size: 10,
    isDirectlySelected: true,
    sourceType: 'sharepoint',
    siteId: 'site-1',
    driveId: 'drive-1',
  };

  it.each([false, true])(
    'refuses sync before effects (mixed: %s)',
    async (mixed) => {
      const deps = makeDeps();
      const items = mixed
        ? [
            {
              ...sharePointItem,
              id: 'personal',
              sourceType: 'onedrive' as const,
            },
            sharePointItem,
          ]
        : [sharePointItem];
      const result = await importFiles(
        { ...baseArgs, items, importType: 'sync' },
        deps,
      );
      expect(result.success).toBe(false);
      expect(result.successCount).toBe(0);
      expect(result.failedCount).toBe(items.length);
      expect(result.results.every((row) => row.status === 'error')).toBe(true);
      expect(deps.upsertSyncConfig).not.toHaveBeenCalled();
      expect(deps.getFileMetadata).not.toHaveBeenCalled();
      expect(deps.downloadToStorage).not.toHaveBeenCalled();
      expect(deps.createDocument).not.toHaveBeenCalled();
    },
  );

  it('imports SharePoint once with manual metadata and no registration', async () => {
    const deps = makeDeps();
    const result = await importFiles(
      { ...baseArgs, items: [sharePointItem], importType: 'one-time' },
      deps,
    );
    expect(result.success).toBe(true);
    expect(deps.upsertSyncConfig).not.toHaveBeenCalled();
    expect(deps.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ sourceMode: 'manual' }),
      }),
    );
    expect(
      vi.mocked(deps.createDocument).mock.calls[0][0].metadata,
    ).not.toHaveProperty('syncConfigId');
  });

  it('keeps a refused SharePoint metadata read a failure', async () => {
    const deps = makeDeps({
      getFileMetadata: vi
        .fn()
        .mockResolvedValue({ success: false, error: 'refused' }),
    });
    const result = await importFiles(
      { ...baseArgs, items: [sharePointItem], importType: 'one-time' },
      deps,
    );
    expect(result.success).toBe(false);
    expect(result.failedCount).toBe(1);
    expect(deps.upsertSyncConfig).not.toHaveBeenCalled();
    expect(deps.createDocument).not.toHaveBeenCalled();
  });
});

/**
 * The sync binding — `sourceMode: 'auto'` + `syncConfigId` — is what lets a
 * later run update and prune a document. The regression under test: the
 * metadata was rebuilt from the CURRENT import type and written whole, so a
 * one-time re-import of a changed file inside a synced folder rewrote it to
 * manual (never pruned again once the source file was deleted), while a
 * sync import over an unchanged one-time document skipped it without ever
 * adopting it.
 */
describe('importFiles keeps the sync binding', () => {
  const syncOwned = {
    _id: 'doc-9' as Id<'documents'>,
    contentHash: 'old',
    metadata: {
      sourceMode: 'auto',
      syncConfigId: 'cfg-9',
      isDirectlySelected: true,
      selectedParentId: 'file-a',
    },
  };

  it('keeps a sync-owned document bound when a one-time import re-imports it changed', async () => {
    const deps = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue(syncOwned),
      getFileMetadata: vi
        .fn()
        .mockResolvedValue({ success: true, data: { hash: 'new' } }),
    });

    const result = await importFiles(
      {
        ...baseArgs,
        items: [{ id: 'file-a', name: 'a.docx', size: 10 }],
        importType: 'one-time',
      },
      deps,
    );

    expect(result.successCount).toBe(1);
    expect(deps.updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-9',
        metadata: expect.objectContaining({
          sourceMode: 'auto',
          syncConfigId: 'cfg-9',
          isDirectlySelected: true,
          selectedParentId: 'file-a',
        }),
      }),
    );
  });

  it('still re-imports a manual document as manual', async () => {
    const updateDocument = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue({
        _id: 'doc-2' as Id<'documents'>,
        contentHash: 'old',
        metadata: { sourceMode: 'manual' },
      }),
      getFileMetadata: vi
        .fn()
        .mockResolvedValue({ success: true, data: { hash: 'new' } }),
      updateDocument,
    });

    await importFiles(
      {
        ...baseArgs,
        items: [{ id: 'file-a', name: 'a.docx', size: 10 }],
        importType: 'one-time',
      },
      deps,
    );

    expect(updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          syncConfigId: expect.anything(),
        }),
      }),
    );
    expect(updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ sourceMode: 'manual' }),
      }),
    );
  });

  it('adopts an unchanged document from an earlier one-time import into the sync config', async () => {
    const bindDocumentToSync = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue({
        _id: 'doc-1' as Id<'documents'>,
        contentHash: 'same',
        metadata: { sourceMode: 'manual' },
      }),
      getFileMetadata: vi
        .fn()
        .mockResolvedValue({ success: true, data: { hash: 'same' } }),
      bindDocumentToSync,
    });

    const result = await importFiles(
      { ...baseArgs, items: folderItems, importType: 'sync' },
      deps,
    );

    expect(result.skippedCount).toBe(1);
    expect(bindDocumentToSync).toHaveBeenCalledWith({
      documentId: 'doc-1',
      metadata: {
        sourceMode: 'auto',
        syncConfigId: 'cfg-1',
        selectedParentId: 'folder-meetings',
        selectedParentName: 'Meetings',
        selectedParentPath: 'Meetings',
        isDirectlySelected: false,
      },
    });
    expect(deps.downloadToStorage).not.toHaveBeenCalled();
    expect(deps.updateDocument).not.toHaveBeenCalled();
  });

  it('leaves an unchanged document alone when it is already bound to this config', async () => {
    const bindDocumentToSync = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue({
        _id: 'doc-1' as Id<'documents'>,
        contentHash: 'same',
        metadata: { sourceMode: 'auto', syncConfigId: 'cfg-1' },
      }),
      getFileMetadata: vi
        .fn()
        .mockResolvedValue({ success: true, data: { hash: 'same' } }),
      bindDocumentToSync,
    });

    await importFiles(
      { ...baseArgs, items: folderItems, importType: 'sync' },
      deps,
    );

    expect(bindDocumentToSync).not.toHaveBeenCalled();
  });
});

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
      DOCX_MIME,
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
      DOCX_MIME,
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
      DOCX_MIME,
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
      DOCX_MIME,
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

/**
 * A vendor file WITHOUT a content hash (Graph omits `file.hashes` for some
 * item types and in-flight uploads) used to be re-downloaded on every scan.
 * The source's size + modified stamp now stands in for the hash.
 */
describe('importFiles hash-less change detection [ODRIVE-R3]', () => {
  const stamped = {
    _id: 'doc-1' as Id<'documents'>,
    metadata: {
      sourceMode: 'auto',
      syncConfigId: 'cfg-1',
      sourceFingerprint: '10:1700000000000',
    },
  };

  it('skips an unchanged hash-less file by its stamped size + modified fingerprint', async () => {
    const deps = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue(stamped),
      getFileMetadata: vi.fn().mockResolvedValue({
        success: true,
        data: { size: 10, modifiedAt: 1700000000000 },
      }),
    });

    const result = await importFiles(
      { ...baseArgs, items: folderItems, importType: 'sync' },
      deps,
    );

    expect(result.skippedCount).toBe(1);
    expect(deps.downloadToStorage).not.toHaveBeenCalled();
    expect(deps.updateDocument).not.toHaveBeenCalled();
  });

  it('re-downloads a hash-less file whose modified stamp moved and re-stamps the fingerprint', async () => {
    const deps = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue(stamped),
      getFileMetadata: vi.fn().mockResolvedValue({
        success: true,
        data: { size: 10, modifiedAt: 1700000005000 },
      }),
    });

    const result = await importFiles(
      { ...baseArgs, items: folderItems, importType: 'sync' },
      deps,
    );

    expect(result.successCount).toBe(1);
    expect(deps.downloadToStorage).toHaveBeenCalledTimes(1);
    expect(deps.updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        contentHash: undefined,
        metadata: expect.objectContaining({
          sourceFingerprint: '10:1700000005000',
        }),
      }),
    );
  });

  it('re-downloads a hash-less file when the vendor gives no usable stamp', async () => {
    const deps = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue(stamped),
      getFileMetadata: vi
        .fn()
        .mockResolvedValue({ success: true, data: { size: 10 } }),
    });

    await importFiles(
      { ...baseArgs, items: folderItems, importType: 'sync' },
      deps,
    );

    expect(deps.downloadToStorage).toHaveBeenCalledTimes(1);
    expect(deps.updateDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          sourceFingerprint: expect.anything(),
        }),
      }),
    );
  });

  it('never lets a fingerprint override a present hash', async () => {
    const deps = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue({
        ...stamped,
        contentHash: 'old',
      }),
      getFileMetadata: vi.fn().mockResolvedValue({
        success: true,
        data: { hash: 'new', size: 10, modifiedAt: 1700000000000 },
      }),
    });

    await importFiles(
      { ...baseArgs, items: folderItems, importType: 'sync' },
      deps,
    );

    expect(deps.downloadToStorage).toHaveBeenCalledTimes(1);
  });
});

/**
 * A folder sync files what it ADOPTS. The regression under test: the folder
 * chain was created on the new/changed path only, so a file already in the
 * hub (an earlier one-time import at the root) was adopted by the folder's
 * config — bound, synced, pruned — but stayed at the root, and a folder whose
 * every file was adopted never got a folder row at all, so nothing offered
 * "Stop syncing" (2026-09-14).
 */
describe('importFiles files an adopted document under its selected folder', () => {
  const atRoot = {
    _id: 'doc-1' as Id<'documents'>,
    contentHash: 'h1',
    metadata: { sourceMode: 'manual' },
    folderId: null,
  };
  const unchanged = () =>
    vi.fn().mockResolvedValue({ success: true, data: { hash: 'h1' } });

  it('creates the sync root first, then moves the unchanged root document into it', async () => {
    const setDocumentFolder = vi.fn().mockResolvedValue(undefined);
    const bindDocumentToSync = vi.fn().mockResolvedValue(undefined);
    const getOrCreateFolderPath = vi
      .fn()
      .mockResolvedValue('folder-meetings' as Id<'folders'>);
    const deps = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue(atRoot),
      getFileMetadata: unchanged(),
      getOrCreateFolderPath,
      setDocumentFolder,
      bindDocumentToSync,
    });

    const result = await importFiles(
      { ...baseArgs, items: folderItems, importType: 'sync' },
      deps,
    );

    expect(result.skippedCount).toBe(1);
    expect(deps.downloadToStorage).not.toHaveBeenCalled();
    expect(getOrCreateFolderPath).toHaveBeenNthCalledWith(
      1,
      'org-1',
      ['Meetings'],
      'user-1',
      undefined,
      undefined,
    );
    expect(bindDocumentToSync).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        metadata: expect.objectContaining({ syncConfigId: 'cfg-1' }),
      }),
    );
    expect(setDocumentFolder).toHaveBeenCalledWith({
      documentId: 'doc-1',
      folderId: 'folder-meetings',
    });
  });

  it('leaves a document that already sits in that folder alone', async () => {
    const setDocumentFolder = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      findDocumentByExternalId: vi
        .fn()
        .mockResolvedValue({ ...atRoot, folderId: 'folder-row-1' }),
      getFileMetadata: unchanged(),
      setDocumentFolder,
    });
    await importFiles(
      { ...baseArgs, items: folderItems, importType: 'sync' },
      deps,
    );
    expect(setDocumentFolder).not.toHaveBeenCalled();
  });

  it('does not move on a one-time import, and never back to the root', async () => {
    const setDocumentFolder = vi.fn().mockResolvedValue(undefined);
    const oneTime = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue(atRoot),
      getFileMetadata: unchanged(),
      setDocumentFolder,
    });
    await importFiles(
      { ...baseArgs, items: folderItems, importType: 'one-time' },
      oneTime,
    );
    expect(setDocumentFolder).not.toHaveBeenCalled();

    // A directly picked file synced from the drive's root: the person moved
    // its mirror into a hub folder by hand, and the sync keeps that.
    const getOrCreateFolderPath = vi
      .fn()
      .mockResolvedValue('folder-row-1' as Id<'folders'>);
    const moved = makeDeps({
      findDocumentByExternalId: vi
        .fn()
        .mockResolvedValue({ ...atRoot, folderId: 'folder-by-hand' }),
      getFileMetadata: unchanged(),
      getOrCreateFolderPath,
      setDocumentFolder,
    });
    await importFiles(
      {
        ...baseArgs,
        items: [
          {
            id: 'file-a',
            name: 'a.docx',
            size: 10,
            relativePath: 'a.docx',
            isDirectlySelected: true,
          },
        ],
        importType: 'sync',
      },
      moved,
    );
    expect(setDocumentFolder).not.toHaveBeenCalled();
    expect(getOrCreateFolderPath).not.toHaveBeenCalled();
  });
});

/**
 * Where an import lands. Placement used to come only from mirroring the
 * provider's own path, so a file picked at the top of the picker had no
 * path to mirror and went to the hub root whatever folder the person had
 * open. `destinationFolderId` is that folder.
 */
describe('onedrive importFiles placement [ODRIVE-R4]', () => {
  const rootFile: ImportItem[] = [
    { id: 'file-r', name: 'r.docx', size: 10, relativePath: 'r.docx' },
  ];

  it('files a path-less pick into the destination instead of the root', async () => {
    const deps = makeDeps();
    await importFiles(
      {
        ...baseArgs,
        items: rootFile,
        importType: 'one-time',
        destinationFolderId: 'folder-product',
      },
      deps as unknown as ImportFilesDependencies,
    );
    expect(deps.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: 'folder-product' }),
    );
  });

  it('still lands at the root when no destination is given', async () => {
    const deps = makeDeps();
    await importFiles(
      { ...baseArgs, items: rootFile, importType: 'one-time' },
      deps as unknown as ImportFilesDependencies,
    );
    expect(deps.createDocument).toHaveBeenCalledWith(
      expect.objectContaining({ folderId: undefined }),
    );
  });

  it('mirrors a provider subfolder UNDER the destination, not beside it', async () => {
    const getOrCreateFolderPath = vi
      .fn()
      .mockResolvedValue('folder-meetings' as Id<'folders'>);
    const deps = makeDeps({ getOrCreateFolderPath });
    await importFiles(
      {
        ...baseArgs,
        items: folderItems,
        importType: 'one-time',
        destinationFolderId: 'folder-product',
      },
      deps as unknown as ImportFilesDependencies,
    );
    expect(getOrCreateFolderPath).toHaveBeenCalledWith(
      'org-1',
      ['Meetings'],
      'user-1',
      undefined,
      'folder-product',
    );
  });
});

/** The sentence `resolveGraphTokenForUser` answers a grant that needs
 *  reconnecting with — the one every listing hands to the connect dialog. */
const RECONNECT =
  'OneDrive is not authorized for importing. Connect Microsoft 365 from Documents.';

/** `count` files at the top of the selection, from OneDrive or from a
 *  SharePoint library (the same pipeline serves both). */
function files(count: number, source: 'OneDrive' | 'SharePoint'): ImportItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `file-${index + 1}`,
    name: `f${index + 1}.docx`,
    size: 10,
    relativePath: `f${index + 1}.docx`,
    ...(source === 'SharePoint' && {
      siteId: 'site-1',
      driveId: 'drive-1',
      sourceType: 'sharepoint' as const,
    }),
  }));
}

/** A grant that reads live before the first `live` files, then answers
 *  "reconnect" (revoked, or its refresh token dead). */
function grantEndingAfter(live: number) {
  let reads = 0;
  return vi.fn(async () =>
    ++reads <= live
      ? { success: true as const, token: 'tok' }
      : { success: false as const, error: RECONNECT, needsReauth: true },
  );
}

/** Graph refusing the token for `refusedIds` while it is `refusedToken`. */
function metadataRefusing(
  refusedIds: ReadonlySet<string>,
  refusedToken = 'tok',
) {
  return vi.fn(async (itemId: string, token: string) =>
    refusedIds.has(itemId) && token === refusedToken
      ? {
          success: false,
          error:
            'Failed to get file metadata: 401 {"error":{"code":"InvalidAuthenticationToken"}}',
          unauthorized: true,
        }
      : { success: true, data: { hash: `h-${itemId}` } },
  );
}

/**
 * A grant revoked or expired while an import runs. The route read the grant
 * once, so every file after the lapse failed on a refused token and the
 * import read as failed whole — the files already imported went unsaid.
 * The grant is read again before each file now, and refreshed once when
 * Graph refuses the token: a grant that answers "reconnect" stops the
 * import at that file, keeps the files before it, and answers the grant's
 * own sentence, which the dialog hands to the connect dialog.
 */
describe.each(['OneDrive', 'SharePoint'] as const)(
  'onedrive importFiles when the grant ends part-way (%s)',
  (source) => {
    it('stops at the file the grant ended at, keeping the files before it', async () => {
      const deps = makeDeps({ resolveToken: grantEndingAfter(2) });

      const result = await importFiles(
        { ...baseArgs, items: files(5, source), importType: 'one-time' },
        deps,
      );

      expect(result).toMatchObject({
        success: false,
        totalFiles: 5,
        successCount: 2,
        failedCount: 0,
        skippedCount: 0,
        error: RECONNECT,
      });
      expect(result.results.map((row) => row.fileId)).toEqual([
        'file-1',
        'file-2',
      ]);
      // Nothing past the lapse reached Graph.
      expect(deps.getFileMetadata).toHaveBeenCalledTimes(2);
      expect(deps.downloadToStorage).toHaveBeenCalledTimes(2);
      expect(deps.createDocument).toHaveBeenCalledTimes(2);
    });

    it('refreshes the grant when Graph refuses the token, and carries on', async () => {
      const getFileMetadata = metadataRefusing(new Set(['file-1']));
      const resolveToken = vi.fn(
        async ({ forceRefresh }: { forceRefresh: boolean }) =>
          forceRefresh
            ? { success: true as const, token: 'tok-2' }
            : { success: true as const, token: 'tok' },
      );
      const deps = makeDeps({ getFileMetadata, resolveToken });

      const result = await importFiles(
        { ...baseArgs, items: files(2, source), importType: 'one-time' },
        deps,
      );

      expect(result).toMatchObject({ success: true, successCount: 2 });
      expect(result.error).toBeUndefined();
      expect(getFileMetadata.mock.calls.map(([, token]) => token)).toEqual([
        'tok',
        'tok-2',
        'tok',
      ]);
      expect(resolveToken).toHaveBeenCalledWith({ forceRefresh: true });
    });

    it('stops when Graph refuses the token and the grant cannot be refreshed', async () => {
      const deps = makeDeps({
        getFileMetadata: metadataRefusing(new Set(['file-2'])),
        resolveToken: vi.fn(
          async ({ forceRefresh }: { forceRefresh: boolean }) =>
            forceRefresh
              ? { success: false as const, error: RECONNECT, needsReauth: true }
              : { success: true as const, token: 'tok' },
        ),
      });

      const result = await importFiles(
        { ...baseArgs, items: files(4, source), importType: 'one-time' },
        deps,
      );

      expect(result).toMatchObject({
        success: false,
        totalFiles: 4,
        successCount: 1,
        failedCount: 0,
        error: RECONNECT,
      });
      expect(result.results.map((row) => row.fileId)).toEqual(['file-1']);
      expect(deps.downloadToStorage).toHaveBeenCalledTimes(1);
    });

    it('treats a download refused for its token the same way', async () => {
      const downloadToStorage = vi.fn(async ({ itemId }: { itemId: string }) =>
        itemId === 'file-2'
          ? {
              success: false,
              error:
                'Failed to download file: 401 {"error":{"code":"InvalidAuthenticationToken"}}',
              unauthorized: true,
            }
          : {
              success: true,
              storageId: 'storage-1' as Id<'_storage'>,
              mimeType: 'text/plain',
              size: 10,
            },
      );
      const deps = makeDeps({
        downloadToStorage,
        resolveToken: vi.fn(
          async ({ forceRefresh }: { forceRefresh: boolean }) =>
            forceRefresh
              ? { success: false as const, error: RECONNECT, needsReauth: true }
              : { success: true as const, token: 'tok' },
        ),
      });

      const result = await importFiles(
        { ...baseArgs, items: files(3, source), importType: 'one-time' },
        deps,
      );

      expect(result).toMatchObject({ successCount: 1, error: RECONNECT });
      expect(result.results).toHaveLength(1);
    });

    // The same selection imported again after reconnecting: the provider
    // file id each document records (`external_item_id`) finds the files
    // the first run brought in, and an unchanged one is skipped — never
    // downloaded or created twice.
    it('skips the files already imported when the same selection runs again', async () => {
      const stored = new Map<string, string>();
      const findDocumentByExternalId = vi.fn(
        async ({ externalItemId }: { externalItemId: string }) =>
          stored.has(externalItemId)
            ? {
                _id: `doc-${externalItemId}` as Id<'documents'>,
                contentHash: stored.get(externalItemId),
                metadata: { sourceMode: 'manual' },
              }
            : null,
      );
      const createDocument = vi.fn(
        async (args: { externalItemId: string; contentHash?: string }) => {
          stored.set(args.externalItemId, args.contentHash ?? '');
          return `doc-${args.externalItemId}` as Id<'documents'>;
        },
      );
      const getFileMetadata = metadataRefusing(new Set());
      const selection = files(4, source);

      const first = await importFiles(
        { ...baseArgs, items: selection, importType: 'one-time' },
        makeDeps({
          findDocumentByExternalId,
          createDocument,
          getFileMetadata,
          resolveToken: grantEndingAfter(2),
        }),
      );
      const downloadsAgain = vi.fn().mockResolvedValue({
        success: true,
        storageId: 'storage-2' as Id<'_storage'>,
        mimeType: 'text/plain',
        size: 10,
      });
      const again = await importFiles(
        { ...baseArgs, items: selection, importType: 'one-time' },
        makeDeps({
          findDocumentByExternalId,
          createDocument,
          getFileMetadata,
          downloadToStorage: downloadsAgain,
          resolveToken: grantEndingAfter(4),
        }),
      );

      expect(first).toMatchObject({ successCount: 2, error: RECONNECT });
      expect(again).toMatchObject({
        success: true,
        successCount: 2,
        skippedCount: 2,
        failedCount: 0,
      });
      expect(again.results.map((row) => `${row.fileId}:${row.status}`)).toEqual(
        [
          'file-1:skipped',
          'file-2:skipped',
          'file-3:success',
          'file-4:success',
        ],
      );
      expect(downloadsAgain.mock.calls.map(([args]) => args.itemId)).toEqual([
        'file-3',
        'file-4',
      ]);
      expect(
        createDocument.mock.calls.map(([args]) => args.externalItemId),
      ).toEqual(['file-1', 'file-2', 'file-3', 'file-4']);
    });
  },
);

// A read of the grant that throws mid-import (a database blip, a token
// endpoint that did not answer) used to reject the whole request after the
// files it had done; it now leaves the import on the token it has.
it('onedrive importFiles keeps importing when a grant read throws', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  let reads = 0;
  const deps = makeDeps({
    resolveToken: vi.fn(async () => {
      reads += 1;
      if (reads === 3) throw new Error('fetch failed');
      return { success: true as const, token: 'tok' };
    }),
  });

  const result = await importFiles(
    { ...baseArgs, items: files(4, 'OneDrive'), importType: 'one-time' },
    deps,
  );

  expect(result).toMatchObject({ success: true, successCount: 4 });
  expect(result.error).toBeUndefined();
  vi.mocked(console.warn).mockRestore();
});

// The sync engine passes no resolver: a refused token fails that file, as
// it always did, and the run goes on.
it('onedrive importFiles without a grant resolver fails a refused file and goes on', async () => {
  const deps = makeDeps({
    getFileMetadata: metadataRefusing(new Set(['file-1'])),
  });

  const result = await importFiles(
    { ...baseArgs, items: files(2, 'OneDrive'), importType: 'sync' },
    deps,
  );

  expect(result).toMatchObject({
    success: false,
    successCount: 1,
    failedCount: 1,
  });
  expect(result.error).toBeUndefined();
  expect(result.results[0]).toMatchObject({
    fileId: 'file-1',
    status: 'error',
    error: expect.stringContaining('401'),
  });
  expect(result.results[0]?.reason).toBeUndefined();
});

/**
 * Why a file was refused, for the import's one toast: a refusal Tale wrote
 * for people — the size cap the upload door's 413 words — carries its words
 * as `reason`; a provider's answer or a fault carries none, its text kept in
 * `error` for the log.
 */
describe('onedrive importFiles says why a file was refused', () => {
  it("carries the size cap's words, and only a refusal's", async () => {
    const cap = 'The file exceeds the 512 MiB limit';
    const downloadToStorage = vi.fn(async ({ itemId }: { itemId: string }) => {
      if (itemId === 'file-1') {
        return {
          success: false,
          error: cap,
          refusal: { code: 'FILE_SIZE_INVALID', message: cap },
        };
      }
      if (itemId === 'file-2') {
        return {
          success: false,
          error:
            'Failed to download file: 503 {"error":{"code":"serviceNotAvailable"}}',
        };
      }
      return {
        success: true,
        storageId: 'storage-1' as Id<'_storage'>,
        mimeType: 'text/plain',
        size: 10,
      };
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await importFiles(
      { ...baseArgs, items: files(3, 'OneDrive'), importType: 'one-time' },
      makeDeps({ downloadToStorage }),
    );

    expect(result).toMatchObject({
      success: false,
      totalFiles: 3,
      successCount: 1,
      failedCount: 2,
    });
    expect(result.error).toBeUndefined();
    expect(result.results[0]).toMatchObject({
      fileId: 'file-1',
      status: 'error',
      reason: { code: 'FILE_SIZE_INVALID', message: cap },
    });
    expect(result.results[1]).toMatchObject({
      fileId: 'file-2',
      status: 'error',
      error: expect.stringContaining('503'),
    });
    expect(result.results[1]?.reason).toBeUndefined();
    vi.mocked(console.error).mockRestore();
  });
});
