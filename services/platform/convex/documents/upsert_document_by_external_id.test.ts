import { describe, expect, it } from 'vitest';

import type { MutationCtx } from '../_generated/server';
import { upsertDocumentByExternalId } from './upsert_document_by_external_id';

interface MockDoc {
  _id: string;
  organizationId: string;
  externalItemId?: string;
  folderId?: string;
  folderPath?: string;
  contentHash?: string;
  title?: string;
  fileId?: string;
  metadata?: Record<string, unknown>;
}

interface MockFolder {
  _id: string;
  name: string;
  parentId?: string;
  organizationId: string;
}

function createMockCtx(initial: MockDoc[], initialFolders: MockFolder[] = []) {
  const docs = new Map<string, MockDoc>();
  for (const doc of initial) docs.set(doc._id, doc);
  const folders = new Map<string, MockFolder>();
  for (const f of initialFolders) folders.set(f._id, f);
  let counter = initial.length;
  const inserts: MockDoc[] = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      query: () => ({
        withIndex: (
          _idx: string,
          cb: (q: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          let orgFilter: string | undefined;
          let externalFilter: string | undefined;
          const qb = {
            eq: (field: string, value: unknown) => {
              if (field === 'organizationId') orgFilter = value as string;
              if (field === 'externalItemId') externalFilter = value as string;
              return qb;
            },
          };
          cb(qb);
          const matched: MockDoc[] = [];
          for (const doc of docs.values()) {
            if (
              doc.organizationId === orgFilter &&
              doc.externalItemId === externalFilter
            ) {
              matched.push(doc);
            }
          }
          return {
            [Symbol.asyncIterator]: async function* () {
              for (const m of matched) yield m;
            },
            // The RAG-status reindex gate queries fileMetadata `by_storageId`
            // and calls .first(); these fixtures have no fileMetadata, so the
            // gate stays inactive (matched is empty for that lookup).
            first: async () => matched[0] ?? null,
          };
        },
      }),
      insert: (_table: string, doc: Record<string, unknown>) => {
        const id = `doc_${++counter}`;
        const stored: MockDoc = {
          _id: id,
          organizationId: doc.organizationId as string,
          externalItemId: doc.externalItemId as string | undefined,
          folderId: doc.folderId as string | undefined,
          folderPath: doc.folderPath as string | undefined,
          contentHash: doc.contentHash as string | undefined,
          title: doc.title as string | undefined,
          fileId: doc.fileId as string | undefined,
          metadata: doc.metadata as Record<string, unknown> | undefined,
        };
        docs.set(id, stored);
        inserts.push(stored);
        return Promise.resolve(id);
      },
      patch: (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        const existing = docs.get(id);
        if (existing) {
          docs.set(id, { ...existing, ...patch });
        }
        return Promise.resolve(undefined);
      },
      get: (id: string) =>
        Promise.resolve(folders.get(id) ?? docs.get(id) ?? null),
    },
  };

  return { ctx, docs, inserts, patches };
}

const ORG = 'org1';
const PROVIDER = 'google_drive';

describe('upsertDocumentByExternalId', () => {
  it('inserts a new document when none exists — contentHash omitted on insert', async () => {
    const { ctx, inserts } = createMockCtx([]);
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        sourceProvider: PROVIDER,
        contentHash: 'h1',
      },
    );
    expect(result.action).toBe('created');
    expect(result.contentChanged).toBe(true);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].externalItemId).toBe('gd-1');
    // contentHash is intentionally NOT written on insert — the workflow's
    // finalize step commits it after RAG indexing succeeds so a failed
    // first-time RAG upload auto-retries on the next sync.
    expect(inserts[0].contentHash).toBeUndefined();
  });

  it('returns "skipped" only when content + folder + metadata are all unchanged', async () => {
    const { ctx, inserts, patches } = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        externalItemId: 'gd-1',
        contentHash: 'h1',
        folderPath: 'Sync',
      },
    ]);
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h1',
        folderPathPrefix: 'Sync',
        // No folderId, no metadata → nothing to write.
      },
    );
    expect(result.action).toBe('skipped');
    expect(result.contentChanged).toBe(false);
    expect(result.documentId).toBe('d1');
    expect(inserts).toHaveLength(0);
    expect(patches).toHaveLength(0);
  });

  it('updates content + bumps fileId when contentHash differs', async () => {
    const { ctx, inserts, patches } = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        externalItemId: 'gd-1',
        contentHash: 'h1',
        folderPath: 'Sync',
        fileId: 'storage_old',
      },
    ]);
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h2',
        fileId: 'storage_new' as unknown as never,
        folderPathPrefix: 'Sync',
      },
    );
    expect(result.action).toBe('updated');
    expect(result.contentChanged).toBe(true);
    expect(result.documentId).toBe('d1');
    expect(inserts).toHaveLength(0);
    expect(patches).toHaveLength(1);
    // contentHash is finalized by the workflow's separate step, NOT here.
    expect(patches[0].patch.contentHash).toBeUndefined();
    expect(patches[0].patch.fileId).toBe('storage_new');
    // Title and extension are part of the content-change patch — the H2
    // skip would drop them silently if the dispatcher regressed.
    expect(patches[0].patch.title).toBe('file.txt');
    expect(patches[0].patch.extension).toBe('txt');
    // H2 fix: previous storage handle must land in historyFiles so the
    // blob is reachable for cleanup and version history.
    expect(patches[0].patch.historyFiles).toEqual(['storage_old']);
  });

  it('patches folder only on same-md5 cross-subfolder move (no contentHash bump, no fileId bump)', async () => {
    // The C3 fix: a Drive file moved A → B with identical contents should
    // not orphan-leak Tale rows or re-index RAG.
    const { ctx, patches } = createMockCtx(
      [
        {
          _id: 'd1',
          organizationId: ORG,
          externalItemId: 'gd-1',
          contentHash: 'h1',
          folderId: 'folder_a',
          folderPath: 'Sync/A',
          fileId: 'storage_keep',
        },
      ],
      [
        { _id: 'folder_sync', name: 'Sync', organizationId: ORG },
        {
          _id: 'folder_a',
          name: 'A',
          parentId: 'folder_sync',
          organizationId: ORG,
        },
        {
          _id: 'folder_b',
          name: 'B',
          parentId: 'folder_sync',
          organizationId: ORG,
        },
      ],
    );
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h1',
        fileId: 'storage_new' as unknown as never,
        folderId: 'folder_b' as unknown as never,
        folderPathPrefix: 'Sync',
      },
    );
    expect(result.action).toBe('updated');
    expect(result.contentChanged).toBe(false);
    expect(result.documentId).toBe('d1');
    expect(patches).toHaveLength(1);
    expect(patches[0].patch.folderId).toBe('folder_b');
    expect(patches[0].patch.folderPath).toBe('Sync/B');
    // fileId stays at the prior storage handle — the new download is not
    // needed and should not orphan the previously-indexed blob.
    expect(patches[0].patch.fileId).toBeUndefined();
    expect(patches[0].patch.contentHash).toBeUndefined();
  });

  it('rejects an upsert that would move the row outside the prefix subtree (H4)', async () => {
    const { ctx } = createMockCtx(
      [
        {
          _id: 'd1',
          organizationId: ORG,
          externalItemId: 'gd-1',
          contentHash: 'h1',
          folderId: 'folder_sync_a',
          folderPath: 'SyncA/files',
        },
      ],
      [
        { _id: 'folder_other', name: 'OtherRoot', organizationId: ORG },
        {
          _id: 'folder_outside',
          name: 'X',
          parentId: 'folder_other',
          organizationId: ORG,
        },
      ],
    );
    await expect(
      upsertDocumentByExternalId(ctx as unknown as MutationCtx, {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h1',
        folderId: 'folder_outside' as unknown as never,
        folderPathPrefix: 'SyncA',
      }),
    ).rejects.toThrow(/PREFIX_VIOLATION|outside the sync prefix/);
  });

  it('rejects target folder at the lex-adjacent sibling "Sync 2" against prefix "Sync"', async () => {
    // Lex-edge guard: " " (0x20) sorts below "/" (0x2F), so a naive
    // startsWith(prefix) without the trailing-slash boundary would
    // wrongly accept "Sync 2/x" as a child of "Sync". Confirms
    // isPathUnderPrefix uses the `/`-boundary form.
    const { ctx } = createMockCtx(
      [],
      [
        { _id: 'folder_sync2', name: 'Sync 2', organizationId: ORG },
        {
          _id: 'folder_sync2_x',
          name: 'x',
          parentId: 'folder_sync2',
          organizationId: ORG,
        },
      ],
    );
    await expect(
      upsertDocumentByExternalId(ctx as unknown as MutationCtx, {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h1',
        folderId: 'folder_sync2_x' as unknown as never,
        folderPathPrefix: 'Sync',
      }),
    ).rejects.toThrow(/PREFIX_VIOLATION|outside the sync prefix/);
  });

  it('finds an existing doc anywhere under the prefix subtree (cross-folder move with content change)', async () => {
    const { ctx, patches } = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        externalItemId: 'gd-1',
        contentHash: 'h1',
        folderPath: 'Sync/A',
      },
    ]);
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h2',
        folderPathPrefix: 'Sync',
      },
    );
    expect(result.action).toBe('updated');
    expect(result.contentChanged).toBe(true);
    expect(result.documentId).toBe('d1');
    expect(patches).toHaveLength(1);
  });

  it('does NOT match docs outside the prefix subtree (two independent syncs)', async () => {
    const { ctx, inserts } = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        externalItemId: 'gd-1',
        contentHash: 'h1',
        folderPath: 'SyncA/files',
      },
    ]);
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h1',
        folderPathPrefix: 'SyncB',
      },
    );
    expect(result.action).toBe('created');
    expect(result.contentChanged).toBe(true);
    expect(inserts).toHaveLength(1);
  });

  it('does not consider "Sync 2/x" as a child of "Sync"', async () => {
    const { ctx, inserts } = createMockCtx([
      {
        _id: 'd1',
        organizationId: ORG,
        externalItemId: 'gd-1',
        contentHash: 'h1',
        folderPath: 'Sync 2/x',
      },
    ]);
    const result = await upsertDocumentByExternalId(
      ctx as unknown as MutationCtx,
      {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h1',
        folderPathPrefix: 'Sync',
      },
    );
    expect(result.action).toBe('created');
    expect(inserts).toHaveLength(1);
  });
});
