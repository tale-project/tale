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
  mimeType?: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  /** Controlled-record lifecycle marker — `isRecordContentFrozen` reads
   * only `record.state`. */
  record?: { state: 'draft' | 'in_review' | 'approved' };
}

interface MockFolder {
  _id: string;
  name: string;
  parentId?: string;
  organizationId: string;
  projectId?: string;
}

function createMockCtx(
  initial: MockDoc[],
  initialFolders: MockFolder[] = [],
  // Maps an existing blob storageId → its canonical RAG status row. Drives the
  // reindex gate (`fileMetadata by_storageId .first()`); empty → gate inert.
  fmByStorageId: Record<string, { ragStatus?: string }> = {},
  // Maps storageId → `_storage` sha256. Drives the hash-less content
  // comparison (`db.system.get`); a missing id resolves to null.
  storageSha256: Record<string, string> = {},
) {
  const docs = new Map<string, MockDoc>();
  for (const doc of initial) docs.set(doc._id, doc);
  const folders = new Map<string, MockFolder>();
  for (const f of initialFolders) folders.set(f._id, f);
  let counter = initial.length;
  const inserts: MockDoc[] = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Array<{ args: Record<string, unknown> }> = [];

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
          let storageIdFilter: string | undefined;
          const qb = {
            eq: (field: string, value: unknown) => {
              if (field === 'organizationId') orgFilter = value as string;
              if (field === 'externalItemId') externalFilter = value as string;
              if (field === 'storageId') storageIdFilter = value as string;
              return qb;
            },
          };
          cb(qb);
          // fileMetadata reindex-gate lookup (keyed on storageId only).
          if (storageIdFilter !== undefined) {
            const sid = storageIdFilter;
            return {
              [Symbol.asyncIterator]: async function* () {},
              first: async () => fmByStorageId[sid] ?? null,
            };
          }
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
          projectId: doc.projectId as string | undefined,
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
      system: {
        get: (id: string) =>
          Promise.resolve(
            id in storageSha256 ? { sha256: storageSha256[id] } : null,
          ),
      },
    },
    scheduler: {
      runAfter: (
        _delay: number,
        _ref: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push({ args });
        return Promise.resolve(undefined);
      },
    },
  };

  return { ctx, docs, inserts, patches, scheduled };
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
        fileId: 'storage_new',
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

  describe('project scope follows the target folder', () => {
    // The workflow document path never threaded projectId through, so filed
    // outputs (artifact.xml etc.) landed in project folders WITHOUT projectId —
    // invisible to the project Files tree (listProjectDocuments filters on it).
    const projFolder: MockFolder = {
      _id: 'folder_q4',
      name: '2025Q4',
      organizationId: ORG,
      projectId: 'proj1',
    };

    it('stamps the folder projectId on insert', async () => {
      const { ctx, inserts } = createMockCtx([], [projFolder]);
      const result = await upsertDocumentByExternalId(
        ctx as unknown as MutationCtx,
        {
          organizationId: ORG,
          externalItemId: 'desk-e2e:task1:artifact.xml',
          title: 'artifact.xml',
          fileId: 'storage_1',
          folderId: 'folder_q4' as unknown as never,
        },
      );
      expect(result.action).toBe('created');
      expect(inserts[0].projectId).toBe('proj1');
    });

    it('heals a scope-less row on re-run even when nothing else changed', async () => {
      const { ctx, patches } = createMockCtx(
        [
          {
            _id: 'd1',
            organizationId: ORG,
            externalItemId: 'desk-e2e:task1:artifact.xml',
            folderId: 'folder_q4',
            folderPath: '2025Q4',
            fileId: 'storage_same',
          },
        ],
        [projFolder],
        {},
        { storage_same: 'sha-1' },
      );
      const result = await upsertDocumentByExternalId(
        ctx as unknown as MutationCtx,
        {
          organizationId: ORG,
          externalItemId: 'desk-e2e:task1:artifact.xml',
          title: 'artifact.xml',
          fileId: 'storage_same',
          folderId: 'folder_q4' as unknown as never,
        },
      );
      expect(result.action).toBe('updated');
      expect(result.contentChanged).toBe(false);
      expect(patches).toHaveLength(1);
      expect(patches[0].patch.projectId).toBe('proj1');
      // Content untouched — no fileId churn on a scope-only heal.
      expect(patches[0].patch.fileId).toBeUndefined();
    });

    it('clears the project scope when the doc moves to a hub folder', async () => {
      const { ctx, patches } = createMockCtx(
        [
          {
            _id: 'd1',
            organizationId: ORG,
            externalItemId: 'gd-1',
            folderId: 'folder_q4',
            folderPath: '2025Q4',
            projectId: 'proj1',
            contentHash: 'h1',
          },
        ],
        [projFolder, { _id: 'folder_hub', name: 'Hub', organizationId: ORG }],
      );
      const result = await upsertDocumentByExternalId(
        ctx as unknown as MutationCtx,
        {
          organizationId: ORG,
          externalItemId: 'gd-1',
          title: 'file.txt',
          contentHash: 'h1',
          folderId: 'folder_hub' as unknown as never,
        },
      );
      expect(result.action).toBe('updated');
      expect(patches).toHaveLength(1);
      expect('projectId' in patches[0].patch).toBe(true);
      expect(patches[0].patch.projectId).toBeUndefined();
    });
  });

  describe('hash-less callers (workflow document `create`) — sha256 fallback', () => {
    // Hash-less create freeze: the workflow document action stores a
    // fresh blob and passes NO contentHash. Treating "no hash" as "unchanged"
    // skipped the write, so the row kept serving the old file and the repair
    // loop never converged.
    it('swaps to the new blob when the storage sha256 differs', async () => {
      const { ctx, patches } = createMockCtx(
        [
          {
            _id: 'd1',
            organizationId: ORG,
            externalItemId: 'desk-e2e:proj1:transform.py',
            fileId: 'storage_old',
          },
        ],
        [],
        {},
        { storage_old: 'sha-old', storage_new: 'sha-new' },
      );
      const result = await upsertDocumentByExternalId(
        ctx as unknown as MutationCtx,
        {
          organizationId: ORG,
          externalItemId: 'desk-e2e:proj1:transform.py',
          title: 'transform.py',
          fileId: 'storage_new',
        },
      );
      expect(result.action).toBe('updated');
      expect(result.contentChanged).toBe(true);
      expect(patches).toHaveLength(1);
      expect(patches[0].patch.fileId).toBe('storage_new');
      expect(patches[0].patch.historyFiles).toEqual(['storage_old']);
    });

    it('still skips when the new blob has the same sha256 (true dedup)', async () => {
      const { ctx, patches } = createMockCtx(
        [
          {
            _id: 'd1',
            organizationId: ORG,
            externalItemId: 'desk-e2e:proj1:transform.py',
            fileId: 'storage_old',
          },
        ],
        [],
        {},
        { storage_old: 'sha-same', storage_new: 'sha-same' },
      );
      const result = await upsertDocumentByExternalId(
        ctx as unknown as MutationCtx,
        {
          organizationId: ORG,
          externalItemId: 'desk-e2e:proj1:transform.py',
          title: 'transform.py',
          fileId: 'storage_new',
        },
      );
      expect(result.action).toBe('skipped');
      expect(result.contentChanged).toBe(false);
      expect(patches).toHaveLength(0);
    });

    it('treats a first blob on a fileless row as a content change', async () => {
      const { ctx, patches } = createMockCtx(
        [
          {
            _id: 'd1',
            organizationId: ORG,
            externalItemId: 'desk-e2e:proj1:transform.py',
          },
        ],
        [],
        {},
        { storage_new: 'sha-new' },
      );
      const result = await upsertDocumentByExternalId(
        ctx as unknown as MutationCtx,
        {
          organizationId: ORG,
          externalItemId: 'desk-e2e:proj1:transform.py',
          title: 'transform.py',
          fileId: 'storage_new',
        },
      );
      expect(result.action).toBe('updated');
      expect(result.contentChanged).toBe(true);
      expect(patches[0].patch.fileId).toBe('storage_new');
    });

    it('re-linking the exact same storageId without a hash stays skipped', async () => {
      const { ctx, patches } = createMockCtx(
        [
          {
            _id: 'd1',
            organizationId: ORG,
            externalItemId: 'desk-e2e:proj1:transform.py',
            fileId: 'storage_same',
          },
        ],
        [],
        {},
        { storage_same: 'sha-1' },
      );
      const result = await upsertDocumentByExternalId(
        ctx as unknown as MutationCtx,
        {
          organizationId: ORG,
          externalItemId: 'desk-e2e:proj1:transform.py',
          title: 'transform.py',
          fileId: 'storage_same',
        },
      );
      expect(result.action).toBe('skipped');
      expect(result.contentChanged).toBe(false);
      expect(patches).toHaveLength(0);
    });
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
        fileId: 'storage_new',
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

  describe('frozen record — mimeType is a withheld identity field', () => {
    // `mimeType` sits in the frozen-identity set (`isRecordContentFrozen`
    // doc contract). A location/metadata-only update on an in_review/approved
    // record must not rewrite it; a content change on a frozen record throws
    // earlier via the shared controlled-content guard. Renames stay free.
    const frozenBase: MockDoc = {
      _id: 'd1',
      organizationId: ORG,
      externalItemId: 'workflow:fld_1:return.xml',
      contentHash: 'h1',
      mimeType: 'text/plain',
      record: { state: 'approved' },
    };

    it('requires the dedicated replacement flow for a controlled draft content refresh', async () => {
      const { ctx, patches } = createMockCtx([
        {
          ...frozenBase,
          record: { state: 'draft' },
          fileId: 'old-blob',
        },
      ]);

      await expect(
        upsertDocumentByExternalId(ctx as unknown as MutationCtx, {
          organizationId: ORG,
          externalItemId: 'workflow:fld_1:return.xml',
          title: 'return.xml',
          contentHash: 'h2',
          fileId: 'new-blob',
          sourceProvider: 'agent',
        }),
      ).rejects.toMatchObject({
        data: { code: 'DOCUMENT_RECORD_REPLACEMENT_REQUIRED' },
      });
      expect(patches).toHaveLength(0);
    });

    it('withholds mimeType on a metadata-only update of a frozen record (title stays free)', async () => {
      const { ctx, patches } = createMockCtx([{ ...frozenBase }]);
      const result = await upsertDocumentByExternalId(
        ctx as unknown as MutationCtx,
        {
          organizationId: ORG,
          externalItemId: 'workflow:fld_1:return.xml',
          title: 'return (renamed).xml',
          contentHash: 'h1',
          mimeType: 'application/octet-stream',
          metadata: { note: 'relabel attempt' },
        },
      );
      expect(result.action).toBe('updated');
      expect(result.contentChanged).toBe(false);
      expect(patches).toHaveLength(1);
      expect('mimeType' in patches[0].patch).toBe(false);
      expect(patches[0].patch.title).toBe('return (renamed).xml');
    });

    it('keeps rewriting mimeType for draft-state and uncontrolled rows', async () => {
      const rows: MockDoc[] = [
        { ...frozenBase, record: { state: 'draft' } },
        { ...frozenBase, record: undefined },
      ];
      for (const row of rows) {
        const { ctx, patches } = createMockCtx([row]);
        await upsertDocumentByExternalId(ctx as unknown as MutationCtx, {
          organizationId: ORG,
          externalItemId: 'workflow:fld_1:return.xml',
          title: 'return.xml',
          contentHash: 'h1',
          mimeType: 'application/octet-stream',
          metadata: { note: 'relabel' },
        });
        expect(patches).toHaveLength(1);
        expect(patches[0].patch.mimeType).toBe('application/octet-stream');
      }
    });
  });

  describe('reindex gate (canonical fileMetadata.ragStatus)', () => {
    const indexedDoc: MockDoc = {
      _id: 'd1',
      organizationId: ORG,
      externalItemId: 'gd-1',
      contentHash: 'h1',
      fileId: 'old-blob',
    };

    it('schedules reindex when a RAG-completed doc swaps to a new blob with changed content', async () => {
      const { ctx, scheduled } = createMockCtx([{ ...indexedDoc }], [], {
        'old-blob': { ragStatus: 'completed' },
      });

      const result = await upsertDocumentByExternalId(
        ctx as unknown as MutationCtx,
        {
          organizationId: ORG,
          externalItemId: 'gd-1',
          title: 'file.txt',
          contentHash: 'h2',
          fileId: 'new-blob',
        },
      );

      expect(result.action).toBe('updated');
      expect(result.contentChanged).toBe(true);
      expect(scheduled).toEqual([
        {
          args: {
            documentId: 'd1',
            oldFileId: 'old-blob',
            oldOrganizationId: ORG,
          },
        },
      ]);
    });

    it('does NOT schedule reindex when the existing blob is not RAG-completed', async () => {
      const { ctx, scheduled } = createMockCtx([{ ...indexedDoc }], [], {
        'old-blob': { ragStatus: 'queued' },
      });

      await upsertDocumentByExternalId(ctx as unknown as MutationCtx, {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h2',
        fileId: 'new-blob',
      });

      expect(scheduled).toHaveLength(0);
    });

    it('does NOT schedule reindex when no fileMetadata row exists (migration window)', async () => {
      const { ctx, scheduled } = createMockCtx([{ ...indexedDoc }], [], {});

      await upsertDocumentByExternalId(ctx as unknown as MutationCtx, {
        organizationId: ORG,
        externalItemId: 'gd-1',
        title: 'file.txt',
        contentHash: 'h2',
        fileId: 'new-blob',
      });

      expect(scheduled).toHaveLength(0);
    });
  });
});
