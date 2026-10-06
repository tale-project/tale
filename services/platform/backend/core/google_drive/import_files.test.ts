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

describe('google_drive importFiles keeps the sync binding [GDRIVE-R5]', () => {
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
describe('importFiles hash-less change detection [GDRIVE-R3]', () => {
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
describe('importFiles files an adopted document under its selected folder [GDRIVE-R5]', () => {
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
describe('google_drive importFiles placement [GDRIVE-R4]', () => {
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

/** The sentence `resolveDriveTokenForUser` answers a grant that needs
 *  reconnecting with — the one every listing hands to the connect dialog. */
const RECONNECT =
  'Google Drive is not authorized for importing. Connect Google Drive from Documents.';

/** `count` files at the top of a My Drive selection. */
function files(count: number): ImportItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `file-${index + 1}`,
    name: `f${index + 1}.docx`,
    size: 10,
    relativePath: `f${index + 1}.docx`,
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

/** Drive refusing the token for `refusedIds` while it is `refusedToken`. */
function metadataRefusing(
  refusedIds: ReadonlySet<string>,
  refusedToken = 'tok',
) {
  return vi.fn(async (itemId: string, token: string) =>
    refusedIds.has(itemId) && token === refusedToken
      ? {
          success: false,
          error:
            'Failed to get file metadata: 401 {"error":{"code":401,"message":"Invalid Credentials"}}',
          unauthorized: true,
        }
      : { success: true, data: { hash: `h-${itemId}` } },
  );
}

/**
 * A grant revoked or expired while an import runs — access removed at
 * Google ends the access token at once. The route read the grant once, so
 * every file after the lapse failed on a refused token and the import read
 * as failed whole. The grant is read again before each file now, and
 * refreshed once when Drive refuses the token: a grant that answers
 * "reconnect" stops the import at that file, keeps the files before it, and
 * answers the grant's own sentence.
 */
describe('google_drive importFiles when the grant ends part-way', () => {
  it('stops at the file the grant ended at, keeping the files before it [GDRIVE-R6]', async () => {
    const deps = makeDeps({ resolveToken: grantEndingAfter(2) });

    const result = await importFiles(
      { ...baseArgs, items: files(5), importType: 'one-time' },
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
    expect(deps.getFileMetadata).toHaveBeenCalledTimes(2);
    expect(deps.downloadToStorage).toHaveBeenCalledTimes(2);
  });

  it('refreshes the grant when Drive refuses the token, and carries on [GDRIVE-R6]', async () => {
    const getFileMetadata = metadataRefusing(new Set(['file-1']));
    const deps = makeDeps({
      getFileMetadata,
      resolveToken: vi.fn(
        async ({ forceRefresh }: { forceRefresh: boolean }) =>
          forceRefresh
            ? { success: true as const, token: 'tok-2' }
            : { success: true as const, token: 'tok' },
      ),
    });

    const result = await importFiles(
      { ...baseArgs, items: files(2), importType: 'one-time' },
      deps,
    );

    expect(result).toMatchObject({ success: true, successCount: 2 });
    expect(getFileMetadata.mock.calls.map(([, token]) => token)).toEqual([
      'tok',
      'tok-2',
      'tok',
    ]);
  });

  it('stops when Drive refuses the token and the grant cannot be refreshed [GDRIVE-R6]', async () => {
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
      { ...baseArgs, items: files(4), importType: 'one-time' },
      deps,
    );

    expect(result).toMatchObject({
      success: false,
      totalFiles: 4,
      successCount: 1,
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
              'Failed to download file: 401 {"error":{"code":401,"message":"Invalid Credentials"}}',
            unauthorized: true,
          }
        : {
            success: true,
            storageId: 's3:org-1/blob' as never,
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
      { ...baseArgs, items: files(3), importType: 'one-time' },
      deps,
    );

    expect(result).toMatchObject({ successCount: 1, error: RECONNECT });
    expect(result.results).toHaveLength(1);
  });

  // The same selection imported again after reconnecting: the Drive file id
  // each document records (`external_item_id`) finds the files the first
  // run brought in, and an unchanged one is skipped — never downloaded or
  // created twice.
  it('skips the files already imported when the same selection runs again [GDRIVE-R3]', async () => {
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
    const selection = files(4);

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
      storageId: 's3:org-1/blob-2' as never,
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
    });
    expect(downloadsAgain.mock.calls.map(([args]) => args.itemId)).toEqual([
      'file-3',
      'file-4',
    ]);
    expect(
      createDocument.mock.calls.map(([args]) => args.externalItemId),
    ).toEqual(['file-1', 'file-2', 'file-3', 'file-4']);
  });

  it("carries the size cap's words for a refused file, and only a refusal's", async () => {
    const cap = 'The file exceeds the 512 MiB limit';
    const downloadToStorage = vi.fn(async ({ itemId }: { itemId: string }) =>
      itemId === 'file-1'
        ? {
            success: false,
            error: cap,
            refusal: { code: 'FILE_SIZE_INVALID', message: cap },
          }
        : {
            success: false,
            error: 'Failed to download file: 500 backendError',
          },
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await importFiles(
      { ...baseArgs, items: files(2), importType: 'one-time' },
      makeDeps({ downloadToStorage }),
    );

    expect(result).toMatchObject({ success: false, failedCount: 2 });
    expect(result.results[0]?.reason).toEqual({
      code: 'FILE_SIZE_INVALID',
      message: cap,
    });
    expect(result.results[1]?.reason).toBeUndefined();
    vi.mocked(console.error).mockRestore();
  });
});
