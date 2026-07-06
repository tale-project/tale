import { describe, expect, it, vi } from 'vitest';

// String refs so the hand-built ctx can dispatch runQuery/scheduler by name.
vi.mock('../_generated/api', () => ({
  internal: {
    documents: {
      internal_queries: {
        findDocumentsByExternalId: 'findDocumentsByExternalId',
      },
      internal_mutations: { deleteDocumentById: 'deleteDocumentById' },
      internal_actions: { deleteDocumentFromRag: 'deleteDocumentFromRag' },
    },
  },
}));

// The import pipeline is exercised by import_files.test.ts; here we only care
// about the dedup-and-heal wiring around it, so drive it from the test.
const importFilesMock = vi.fn();
vi.mock('./import_files', () => ({
  importFiles: (...callArgs: unknown[]) => importFilesMock(...callArgs),
}));
vi.mock('./import_files_deps', () => ({
  createImportFilesDeps: vi.fn(() => ({})),
}));

// getFileMetadata is only consulted on the import-error path to tell a deleted
// source (404) from a transient failure.
const getFileMetadataMock = vi.fn();
vi.mock('./get_file_metadata', () => ({
  getFileMetadata: (...callArgs: unknown[]) => getFileMetadataMock(...callArgs),
}));

import type { ActionCtx } from '../_generated/server';
import { reconcileSingleFile } from './run_single_file_reconcile';

interface DocRow {
  _id: string;
  externalItemId?: string;
  fileId?: string;
  metadata?: Record<string, unknown>;
}

interface ScheduledCall {
  delayMs: number;
  ref: string;
  args: Record<string, unknown>;
}

function createCtx(sameExternalId: DocRow[]) {
  const scheduled: ScheduledCall[] = [];

  const runQuery = vi.fn((ref: string) => {
    if (ref === 'findDocumentsByExternalId') {
      return Promise.resolve(sameExternalId);
    }
    throw new Error(`unexpected runQuery ref: ${ref}`);
  });

  const runAfter = vi.fn(
    (delayMs: number, ref: string, args: Record<string, unknown>) => {
      scheduled.push({ delayMs, ref, args });
      return Promise.resolve();
    },
  );

  return {
    ctx: {
      runQuery,
      scheduler: { runAfter },
    } as unknown as ActionCtx,
    scheduled,
    runQuery,
  };
}

const baseArgs = {
  organizationId: 'org-1',
  configId: 'cfg-1',
  itemId: 'item-1',
  itemName: 'Document 1.docx',
  itemPath: 'Document 1.docx',
  userId: 'user-1',
  token: 'tok',
};

describe('reconcileSingleFile', () => {
  it('imports one item through the shared pipeline keyed on the file', async () => {
    importFilesMock.mockResolvedValue({
      results: [{ status: 'success', documentId: 'canonical' }],
      successCount: 1,
      skippedCount: 0,
    });
    const { ctx } = createCtx([{ _id: 'canonical', externalItemId: 'item-1' }]);

    await reconcileSingleFile(ctx, baseArgs);

    const [importArgs] = importFilesMock.mock.calls[0];
    expect(importArgs.importType).toBe('sync');
    expect(importArgs.items).toEqual([
      {
        id: 'item-1',
        name: 'Document 1.docx',
        size: 0,
        relativePath: 'Document 1.docx',
        isDirectlySelected: true,
      },
    ]);
  });

  it('collapses duplicate rows a prior no-dedup run created, keeping the canonical', async () => {
    importFilesMock.mockResolvedValue({
      results: [{ status: 'success', documentId: 'canonical' }],
      successCount: 1,
      skippedCount: 0,
    });
    // The 9.7 KB original (canonical, just upserted) plus two size-less strays
    // a prior run inserted for the same file — one with a blob, one without.
    const { ctx, scheduled } = createCtx([
      {
        _id: 'canonical',
        externalItemId: 'item-1',
        fileId: 'storage-canon',
        metadata: { syncConfigId: 'cfg-1', sourceMode: 'auto' },
      },
      {
        _id: 'stray-blob',
        externalItemId: 'item-1',
        fileId: 'storage-stray',
        metadata: { syncConfigId: 'cfg-1', sourceMode: 'auto' },
      },
      {
        _id: 'stray-meta',
        externalItemId: 'item-1',
        metadata: { syncConfigId: 'cfg-1', sourceMode: 'auto' },
      },
    ]);

    const result = await reconcileSingleFile(ctx, baseArgs);

    expect(result.deleted).toBe(2);
    expect(result.created).toBe(1);
    // Blob-bearing stray → RAG-purging delete with the snapshot guard;
    // metadata-only stray → direct delete. The canonical is never scheduled.
    expect(scheduled).toEqual([
      {
        delayMs: 0,
        ref: 'deleteDocumentFromRag',
        args: {
          documentId: 'stray-blob',
          expectedExternalItemId: 'item-1',
          expectedFileId: 'storage-stray',
          cleanupAncestorsUpTo: undefined,
        },
      },
      {
        delayMs: 100,
        ref: 'deleteDocumentById',
        args: {
          documentId: 'stray-meta',
          callerOrgId: 'org-1',
          cleanupAncestorsUpTo: undefined,
        },
      },
    ]);
  });

  it('never reaps manual uploads or another config’s rows sharing the id', async () => {
    importFilesMock.mockResolvedValue({
      results: [{ status: 'success', documentId: 'canonical' }],
      successCount: 1,
      skippedCount: 0,
    });
    const { ctx, scheduled } = createCtx([
      {
        _id: 'canonical',
        externalItemId: 'item-1',
        metadata: { syncConfigId: 'cfg-1', sourceMode: 'auto' },
      },
      // A manual upload that happens to share the external id — never a stray.
      {
        _id: 'manual',
        externalItemId: 'item-1',
        fileId: 'storage-manual',
        metadata: { sourceMode: 'manual' },
      },
      // A row owned by a different sync config — not ours to prune.
      {
        _id: 'other-config',
        externalItemId: 'item-1',
        fileId: 'storage-other',
        metadata: { syncConfigId: 'cfg-2', sourceMode: 'auto' },
      },
    ]);

    const result = await reconcileSingleFile(ctx, baseArgs);

    expect(result.deleted).toBe(0);
    expect(scheduled).toEqual([]);
  });

  it('throws and prunes nothing on a transient import failure (not a 404)', async () => {
    importFilesMock.mockResolvedValue({
      results: [{ status: 'error', error: 'throttled' }],
      successCount: 0,
      skippedCount: 0,
    });
    // A non-404 failure (permission / throttle / network) must keep the doc.
    getFileMetadataMock.mockResolvedValue({ success: false, notFound: false });
    const { ctx, scheduled, runQuery } = createCtx([
      {
        _id: 'stray',
        externalItemId: 'item-1',
        fileId: 'storage-1',
        metadata: { syncConfigId: 'cfg-1', sourceMode: 'auto' },
      },
    ]);

    await expect(reconcileSingleFile(ctx, baseArgs)).rejects.toThrow(
      'throttled',
    );
    // No canonical row established and the source is not gone → never prune.
    expect(scheduled).toEqual([]);
    expect(runQuery).not.toHaveBeenCalled();
  });

  it('removes the mirror and reports sourceDeleted when the source is 404 gone', async () => {
    importFilesMock.mockResolvedValue({
      results: [{ status: 'error', error: 'Failed to get file metadata: 404' }],
      successCount: 0,
      skippedCount: 0,
    });
    getFileMetadataMock.mockResolvedValue({ success: false, notFound: true });
    // Both owned rows are removed — there is no canonical to keep when the
    // source file is gone.
    const { ctx, scheduled } = createCtx([
      {
        _id: 'doc-a',
        externalItemId: 'item-1',
        fileId: 'storage-a',
        metadata: { syncConfigId: 'cfg-1', sourceMode: 'auto' },
      },
      {
        _id: 'doc-b',
        externalItemId: 'item-1',
        metadata: { syncConfigId: 'cfg-1', sourceMode: 'auto' },
      },
    ]);

    const result = await reconcileSingleFile(ctx, baseArgs);

    expect(result.sourceDeleted).toBe(true);
    expect(result.deleted).toBe(2);
    expect(scheduled.map((s) => s.ref)).toEqual([
      'deleteDocumentFromRag',
      'deleteDocumentById',
    ]);
  });
});
