import { describe, expect, it, vi } from 'vitest';

// String refs so the hand-built ctx can dispatch runQuery/scheduler by name.
vi.mock('../_generated/api', () => ({
  internal: {
    documents: {
      internal_queries: { queryDocuments: 'queryDocuments' },
      internal_mutations: { deleteDocumentById: 'deleteDocumentById' },
      internal_actions: { deleteDocumentFromRag: 'deleteDocumentFromRag' },
    },
    folders: {
      internal_queries: { findFolderByPath: 'findFolderByPath' },
    },
  },
}));

// The import pipeline is exercised by import_files.test.ts; here we only care
// about the prune + folder-reap + RAG-purge wiring, so neutralize it.
vi.mock('./import_files', () => ({
  importFiles: vi
    .fn()
    .mockResolvedValue({ results: [], successCount: 0, skippedCount: 0 }),
}));
vi.mock('./import_files_deps', () => ({
  createImportFilesDeps: vi.fn(() => ({})),
}));

import type { ActionCtx } from '../_generated/server';
import { reconcileFolder } from './run_folder_reconcile';

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

function createCtx(opts: { docs: DocRow[]; rootFolderId: string | null }) {
  const scheduled: ScheduledCall[] = [];
  const findFolderByPathCalls: Array<Record<string, unknown>> = [];

  const runQuery = vi.fn((ref: string, args: Record<string, unknown>) => {
    if (ref === 'queryDocuments') {
      return Promise.resolve({
        page: opts.docs,
        isDone: true,
        continueCursor: '',
      });
    }
    if (ref === 'findFolderByPath') {
      findFolderByPathCalls.push(args);
      return Promise.resolve(opts.rootFolderId);
    }
    throw new Error(`unexpected runQuery ref: ${ref}`);
  });

  // Deletes must flow through the scheduler, never a direct runMutation.
  const runMutation = vi.fn(() => {
    throw new Error(
      'runMutation should not be called; deletes go via scheduler',
    );
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
      runMutation,
      scheduler: { runAfter },
    } as unknown as ActionCtx,
    scheduled,
    findFolderByPathCalls,
  };
}

const baseArgs = {
  organizationId: 'org-1',
  configId: 'cfg-1',
  itemId: 'item-1',
  itemName: 'Meetings',
  itemPath: 'Attachments/Meetings',
  userId: 'user-1',
  token: 'tok',
};

describe('reconcileFolder prune', () => {
  it('purges the RAG index and reaps the empty subfolder for a removed file', async () => {
    // The blob-bearing source file left the folder: delete it through the
    // RAG-purging path (so its vectors go too) and reap the emptied subfolder.
    const { ctx, scheduled, findFolderByPathCalls } = createCtx({
      docs: [
        {
          _id: 'doc-gone',
          externalItemId: 'file-removed',
          fileId: 'storage-1',
          metadata: { syncConfigId: 'cfg-1', sourceMode: 'auto' },
        },
      ],
      rootFolderId: 'folder-root',
    });

    const result = await reconcileFolder(ctx, { ...baseArgs, files: [] });

    expect(result.deleted).toBe(1);
    expect(findFolderByPathCalls).toEqual([
      { organizationId: 'org-1', pathSegments: ['Attachments', 'Meetings'] },
    ]);
    // deleteDocumentFromRag (not a bare deleteDocumentById) drops the vector
    // index, with the folder-reap root and the re-upload snapshot guard.
    expect(scheduled).toEqual([
      {
        delayMs: 0,
        ref: 'deleteDocumentFromRag',
        args: {
          documentId: 'doc-gone',
          expectedExternalItemId: 'file-removed',
          expectedFileId: 'storage-1',
          cleanupAncestorsUpTo: 'folder-root',
        },
      },
    ]);
  });

  it('deletes a metadata-only doc directly (no blob → no RAG round-trip)', async () => {
    const { ctx, scheduled } = createCtx({
      docs: [
        {
          _id: 'doc-note',
          externalItemId: 'file-removed',
          metadata: { syncConfigId: 'cfg-1', sourceMode: 'auto' },
        },
      ],
      rootFolderId: 'folder-root',
    });

    const result = await reconcileFolder(ctx, { ...baseArgs, files: [] });

    expect(result.deleted).toBe(1);
    expect(scheduled).toEqual([
      {
        delayMs: 0,
        ref: 'deleteDocumentById',
        args: {
          documentId: 'doc-note',
          callerOrgId: 'org-1',
          cleanupAncestorsUpTo: 'folder-root',
        },
      },
    ]);
  });

  it('resolves no root and schedules nothing when nothing is pruned', async () => {
    const { ctx, scheduled, findFolderByPathCalls } = createCtx({
      docs: [
        {
          _id: 'doc-kept',
          externalItemId: 'file-present',
          fileId: 'storage-2',
          metadata: { syncConfigId: 'cfg-1', sourceMode: 'auto' },
        },
      ],
      rootFolderId: 'folder-root',
    });

    const result = await reconcileFolder(ctx, {
      ...baseArgs,
      files: [{ id: 'file-present', name: 'a.txt', size: 1 }],
    });

    expect(result.deleted).toBe(0);
    expect(findFolderByPathCalls).toEqual([]);
    expect(scheduled).toEqual([]);
  });
});
