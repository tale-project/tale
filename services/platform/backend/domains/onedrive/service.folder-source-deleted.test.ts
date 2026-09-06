// @vitest-environment node

/**
 * A folder sync whose source folder is gone must reach the terminal state
 * the single-file path already had. The listers throw on any non-OK, so
 * the folder branch stamped `error` on the 404 and the scan re-enqueued the
 * config every tick, forever — with a raw "Failed to list folder contents:
 * 404" on the row. A trashed Drive folder is worse: it lists EMPTY, so the
 * reconcile pruned every mirror and the config stayed `active`, polling.
 *
 * The branch now probes the folder itself on a failed or empty listing: a
 * definitive not-found prunes this config's mirrors and reports
 * `sourceDeleted`; anything else keeps the old behaviour.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  findHubFolderByPath,
  reapEmptyAncestorFolders,
} from '../folders/paths.ts';
import { purgeDocument } from '../retention/service.ts';
import {
  syncOneConfigWith,
  type SyncConfigRow,
  type SyncProviderAdapter,
} from './service.ts';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../lib/org-config.ts', () => ({
  resolveOrgSlug: vi.fn().mockResolvedValue('acme'),
}));
vi.mock('../legal_holds/service.ts', () => ({
  assertNotHeld: vi.fn().mockResolvedValue(undefined),
  LegalHoldError: class LegalHoldError extends Error {},
}));
vi.mock('../retention/service.ts', () => ({
  purgeDocument: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../folders/paths.ts', () => ({
  buildHubFolderPath: vi.fn(),
  findHubFolderByPath: vi.fn().mockResolvedValue('hub-root'),
  getOrCreateHubFolderPath: vi.fn(),
  reapEmptyAncestorFolders: vi.fn().mockResolvedValue(undefined),
}));

const CONFIG: SyncConfigRow = {
  id: 'cfg-1',
  organizationId: 'org-1',
  userId: 'user-1',
  itemType: 'folder',
  itemId: 'folder-1',
  itemName: 'Reports',
  itemPath: 'Reports',
  targetBucket: 'documents',
  storagePrefix: null,
  teamId: null,
  status: 'active',
  lastSyncAt: null,
  lastSyncStatus: null,
  errorMessage: null,
};

/** One mirror this config owns, one another config owns. */
const DOCS = [
  {
    id: 'doc-owned',
    externalItemId: 'f-1',
    fileRef: 'blob-1',
    folderId: 'hub-sub',
    projectId: null,
    historyFiles: [],
    contentHash: 'h1',
    metadata: { sourceMode: 'auto', syncConfigId: 'cfg-1' },
  },
  {
    id: 'doc-other',
    externalItemId: 'f-2',
    fileRef: 'blob-2',
    folderId: 'hub-sub',
    projectId: null,
    historyFiles: [],
    contentHash: 'h2',
    metadata: { sourceMode: 'auto', syncConfigId: 'cfg-other' },
  },
];

function fakeSql(): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$');
    if (text.includes('AND source_provider = $') && text.includes('id > $')) {
      return Promise.resolve(DOCS);
    }
    if (text.includes('created_by AS "createdBy"')) {
      const id = values.find(
        (v): v is string => typeof v === 'string' && v.startsWith('doc-'),
      );
      const row = DOCS.find((doc) => doc.id === id);
      return Promise.resolve(row ? [{ ...row, createdBy: null }] : []);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, { unsafe: (t: string) => t }) as unknown as Sql;
}

function adapter(overrides: Partial<SyncProviderAdapter>): {
  a: SyncProviderAdapter;
  runImport: ReturnType<typeof vi.fn>;
} {
  const runImport = vi.fn().mockResolvedValue({
    success: true,
    successCount: 0,
    failedCount: 0,
    skippedCount: 0,
    results: [],
  });
  const a: SyncProviderAdapter = {
    displayName: 'Fake Drive',
    sourceProvider: 'fake',
    configTable: 'app.onedrive_sync_configs',
    configJobName: 'onedrive.sync_config',
    singletonPrefix: 'fake-sync-',
    metadataItemIdKeys: [],
    resolveToken: () => Promise.resolve({ success: true, token: 'tok' }),
    listFolderContents: () => Promise.resolve({ success: true, files: [] }),
    getFileMetadata: () => Promise.resolve({ success: true, data: {} }),
    buildDownloadUrl: () => 'https://vendor.invalid/x',
    runImport,
    ...overrides,
  };
  return { a, runImport };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('syncOneConfigWith — folder gone at the source', () => {
  it('a failed listing whose folder is not found prunes the owned mirrors and reports sourceDeleted', async () => {
    const getFileMetadata = vi.fn().mockResolvedValue({
      success: false,
      error: 'Failed to get file metadata: 404 itemNotFound',
      notFound: true,
    });
    const { a, runImport } = adapter({
      listFolderContents: () =>
        Promise.resolve({
          success: false,
          error: 'Failed to list folder contents: 404 itemNotFound',
        }),
      getFileMetadata,
    });

    const result = await syncOneConfigWith(fakeSql(), a, CONFIG);

    expect(result).toEqual({
      created: 0,
      skipped: 0,
      deleted: 1,
      errorsCount: 0,
      sourceDeleted: true,
    });
    expect(getFileMetadata).toHaveBeenCalledWith('folder-1', 'tok');
    expect(runImport).not.toHaveBeenCalled();
    // Only this config's mirror goes; the other config's document stays.
    expect(purgeDocument).toHaveBeenCalledTimes(1);
    expect(purgeDocument).toHaveBeenCalledWith(
      expect.anything(),
      'acme',
      expect.objectContaining({ id: 'doc-owned', fileRef: 'blob-1' }),
    );
    // Emptied subfolders are reaped up to — never including — the root.
    expect(findHubFolderByPath).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      ['Reports'],
    );
    expect(reapEmptyAncestorFolders).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        startFolderId: 'hub-sub',
        stopAtFolderId: 'hub-root',
      }),
    );
  });

  it('a failed listing whose folder still exists fails the run as before — nothing pruned', async () => {
    const { a, runImport } = adapter({
      listFolderContents: () =>
        Promise.resolve({
          success: false,
          error: 'Failed to list folder contents: 503 throttled',
        }),
    });

    await expect(syncOneConfigWith(fakeSql(), a, CONFIG)).rejects.toThrow(
      'Failed to list folder contents: 503 throttled',
    );
    expect(purgeDocument).not.toHaveBeenCalled();
    expect(runImport).not.toHaveBeenCalled();
  });

  it('an empty listing of a trashed folder (Drive lists it empty) reports sourceDeleted', async () => {
    const { a, runImport } = adapter({
      listFolderContents: () => Promise.resolve({ success: true, files: [] }),
      getFileMetadata: () =>
        Promise.resolve({
          success: false,
          error: 'Failed to get file metadata: Reports is in the trash',
          notFound: true,
        }),
    });

    const result = await syncOneConfigWith(fakeSql(), a, CONFIG);

    expect(result.sourceDeleted).toBe(true);
    expect(result.deleted).toBe(1);
    expect(runImport).not.toHaveBeenCalled();
  });

  it('an empty listing of a folder that still exists reconciles as an emptied folder', async () => {
    const getFileMetadata = vi
      .fn()
      .mockResolvedValue({ success: true, data: {} });
    const { a, runImport } = adapter({ getFileMetadata });

    const result = await syncOneConfigWith(fakeSql(), a, CONFIG);

    expect(result.sourceDeleted).toBeUndefined();
    expect(getFileMetadata).toHaveBeenCalledTimes(1);
    expect(runImport).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ items: [], importType: 'sync' }),
    );
    // The emptied folder's departed mirror is pruned as before.
    expect(result.deleted).toBe(1);
  });

  it('a listing with files never probes the folder', async () => {
    const getFileMetadata = vi.fn();
    const { a, runImport } = adapter({
      listFolderContents: () =>
        Promise.resolve({
          success: true,
          files: [{ id: 'f-1', name: 'a.txt', size: 3 }],
        }),
      getFileMetadata,
    });

    const result = await syncOneConfigWith(fakeSql(), a, CONFIG);

    expect(getFileMetadata).not.toHaveBeenCalled();
    expect(result.sourceDeleted).toBeUndefined();
    expect(result.deleted).toBe(0);
    expect(runImport).toHaveBeenCalledTimes(1);
  });
});
