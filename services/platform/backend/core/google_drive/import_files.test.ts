import { describe, expect, it, vi } from 'vitest';

import type { Id } from '../lib/rows';
import {
  importFiles,
  type ImportFilesDependencies,
  type ImportItem,
} from './import_files';

/**
 * The Google Drive twin of the OneDrive import pipeline carries the same
 * sync binding (`sourceMode: 'auto'` + `syncConfigId`), and had the same
 * two holes: a one-time re-import of a changed file detached a sync-owned
 * document, and a sync import over an unchanged one-time document never
 * adopted it.
 */

function makeDeps(overrides: Partial<ImportFilesDependencies> = {}) {
  const deps = {
    getFileMetadata: vi
      .fn()
      .mockResolvedValue({ success: true, data: { hash: 'same' } }),
    downloadToStorage: vi.fn().mockResolvedValue({
      success: true,
      storageId: 's3:org-1/blob' as never,
      mimeType: 'text/plain',
      size: 10,
    }),
    findDocumentByExternalId: vi.fn().mockResolvedValue(null),
    createDocument: vi.fn().mockResolvedValue('doc-new'),
    updateDocument: vi.fn().mockResolvedValue(undefined),
    saveFileMetadata: vi.fn().mockResolvedValue(undefined),
    linkDocumentToFile: vi.fn().mockResolvedValue(undefined),
    scheduleHubDocumentRagIndexing: vi.fn().mockResolvedValue(undefined),
    upsertSyncConfig: vi.fn().mockResolvedValue('cfg-1'),
  };
  return { ...deps, ...overrides };
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

describe('google_drive importFiles keeps the sync binding', () => {
  it('keeps a sync-owned document bound when a one-time import re-imports it changed', async () => {
    const deps = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue({
        _id: 'doc-9' as Id<'documents'>,
        contentHash: 'old',
        metadata: {
          sourceMode: 'auto',
          syncConfigId: 'cfg-9',
          isDirectlySelected: true,
        },
      }),
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
          googleDriveItemId: 'file-a',
          sourceMode: 'auto',
          syncConfigId: 'cfg-9',
          isDirectlySelected: true,
        }),
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
  });

  it('leaves an unchanged document alone when it is already bound to this config', async () => {
    const bindDocumentToSync = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      findDocumentByExternalId: vi.fn().mockResolvedValue({
        _id: 'doc-1' as Id<'documents'>,
        contentHash: 'same',
        metadata: { sourceMode: 'auto', syncConfigId: 'cfg-1' },
      }),
      bindDocumentToSync,
    });

    await importFiles(
      { ...baseArgs, items: folderItems, importType: 'sync' },
      deps,
    );

    expect(bindDocumentToSync).not.toHaveBeenCalled();
  });
});

/**
 * A vendor file WITHOUT a content hash (Graph omits `file.hashes` for some
 * item types and in-flight uploads) used to be re-downloaded on every scan.
 * The source's size + modified stamp now stands in for the hash.
 */
describe('importFiles hash-less change detection', () => {
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
describe('google_drive importFiles placement', () => {
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
