// @vitest-environment node

/**
 * A shared ref's corpus row carries its HOLDER's scope — the lowest-id
 * active document holding it — and a WebDAV write can move the holder
 * without editing any document's scope: a COPY inserts a twin whose random
 * id may sort first, a DELETE (or a folder cascade, or an overwritten
 * destination) trashes the holder, a PUT moves a document off its old
 * bytes. Nothing re-stamped the row after those writes, so a scope-filtered
 * search from the new holder's team or folder missed it until the nightly
 * reconcile wrote it back and counted it as a failed sync. Each handler now
 * hands the refs whose holders it moved to `syncRagRefHolderScopes`, once
 * its transaction has committed — and never for a write that rolled back.
 * What the helper writes is `scope-reconcile.test.ts`'s to pin.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { syncRagRefHolderScopes, syncCalls, state } = vi.hoisted(() => {
  const commits = { committed: 0 };
  const recorded: { refs: string[]; committedBefore: number }[] = [];
  return {
    state: commits,
    syncCalls: recorded,
    syncRagRefHolderScopes: vi.fn(
      (_sql: unknown, _organizationId: string, refs: string[]) => {
        recorded.push({ refs: [...refs], committedBefore: commits.committed });
        return Promise.resolve();
      },
    ),
  };
});

vi.mock('../knowledge/service.ts', () => ({
  markRagQueued: vi.fn(() => Promise.resolve()),
  syncRagDocumentScope: vi.fn(() => Promise.resolve()),
  syncRagFolderSubtree: vi.fn(() => Promise.resolve()),
  syncRagRefHolderScopes,
}));
vi.mock('../documents/audit.ts', () => ({
  auditDocumentCreated: vi.fn(() => Promise.resolve()),
  auditDocumentRemoved: vi.fn(() => Promise.resolve()),
  auditDocumentUpdated: vi.fn(() => Promise.resolve()),
  auditFolderDeleted: vi.fn(() => Promise.resolve()),
}));
vi.mock('../knowledge_entries/service.ts', () => ({
  markEntryChainDeletedForDocument: vi.fn(() => Promise.resolve()),
}));
vi.mock('../legal_holds/service.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../legal_holds/service.ts')>()),
  assertNotHeld: vi.fn(() => Promise.resolve()),
  loadActiveHolds: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../../auth/membership.ts', () => ({
  findOrganizationMember: vi.fn(() => Promise.resolve({ role: 'admin' })),
  getUserTeamIds: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../files/service.ts', () => ({
  registerUploadedBytes: vi.fn(() => Promise.resolve({ fileId: 'fm-new' })),
}));
vi.mock('../../jobs/enqueue.ts', () => ({
  addJobInTx: vi.fn(() => Promise.resolve()),
}));

const { webdavHandlers } = await import('./handlers.ts');

const ORG = 'org-1';

interface Doc {
  id: string;
  title: string;
  fileRef: string | null;
  folderId: string | null;
  projectId: string | null;
  teamTags: string[];
  lifecycleStatus: string | null;
}

interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  teamTags: string[];
}

function docRow(doc: Doc) {
  return {
    mimeType: 'application/pdf',
    extension: 'pdf',
    contentHash: null,
    sourceProvider: 'webdav',
    sourceModifiedAt: null,
    record: null,
    createdBy: 'u1',
    createdAt: 1,
    ...doc,
  };
}

function folderRow(folder: Folder) {
  return { projectId: null, createdAt: 1, ...folder };
}

/**
 * An in-memory document tree answering the statements the tree mutations
 * send, by their text. `begin` runs its body on the same handle and counts
 * a commit once the body resolves; a body that throws commits nothing.
 */
function fakeTree(docs: Doc[], folders: Folder[] = []): Sql {
  let inserted = 0;
  const answer = (text: string, values: unknown[]): unknown[] => {
    const has = (part: string) => text.includes(part);
    if (has('FROM app.folders WHERE id = ? AND org_id = ?')) {
      return folders.filter((f) => f.id === values[1]).map(folderRow);
    }
    if (has('FROM app.folders WHERE org_id = ? AND project_id IS NULL')) {
      return folders
        .filter((f) => f.parentId === values[2] && f.name === values[3])
        .map(folderRow);
    }
    if (has('FROM app.folders WHERE org_id = ? AND parent_id = ?')) {
      return folders.filter((f) => f.parentId === values[1]).map(folderRow);
    }
    if (has('FROM app.documents WHERE id = ? AND org_id = ?')) {
      return docs.filter((d) => d.id === values[1]).map(docRow);
    }
    if (has('FROM app.documents WHERE org_id = ? AND title = ?')) {
      return docs
        .filter((d) => d.title === values[2] && d.folderId === values[3])
        .map(docRow);
    }
    if (has('FROM app.documents WHERE org_id = ? AND folder_id = ?')) {
      return docs.filter((d) => d.folderId === values[2]).map(docRow);
    }
    if (has('FROM app.documents WHERE org_id = ? AND file_ref = ?')) {
      return docs.filter((d) => d.fileRef === values[1]);
    }
    if (text.startsWith('INSERT INTO app.')) {
      inserted += 1;
      return [{ id: `new-${inserted}` }];
    }
    if (has("SET lifecycle_status = 'trashed'")) {
      const doc = docs.find((d) => d.id === values.at(-1));
      if (doc) doc.lifecycleStatus = 'trashed';
      return [];
    }
    return [];
  };
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) =>
    Promise.resolve(
      answer(strings.join('?').replace(/\s+/g, ' ').trim(), values),
    );
  const sql = Object.assign(tag, {
    unsafe: (raw: string) => raw,
    begin: async (body: (tx: unknown) => Promise<unknown>) => {
      const result = await body(tag);
      state.committed += 1;
      return result;
    },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a template-tag stand-in for postgres.js
  return sql as unknown as Sql;
}

const doc = (over: Partial<Doc> & { id: string }): Doc => ({
  title: `${over.id}.pdf`,
  fileRef: `s3:${over.id}`,
  folderId: null,
  projectId: null,
  teamTags: [],
  lifecycleStatus: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  syncCalls.length = 0;
  state.committed = 0;
});

describe('WebDAV writes re-stamp the holders they moved, after commit', () => {
  it('COPY of a document: the ref the copy shares', async () => {
    const handlers = webdavHandlers(fakeTree([doc({ id: 'src' })]));

    await handlers['webdav/tree_mutations:copyResource']({
      organizationId: ORG,
      src: { kind: 'document', id: 'src' },
      destParentSegments: [],
      destName: 'copy.pdf',
      overwrite: false,
      userId: 'u1',
    });

    expect(syncCalls).toEqual([{ refs: ['s3:src'], committedBefore: 1 }]);
    expect(syncRagRefHolderScopes).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      ['s3:src'],
    );
  });

  it('COPY of a folder: every ref its copies share, nested folders included', async () => {
    const handlers = webdavHandlers(
      fakeTree(
        [
          doc({ id: 'a', folderId: 'f-top' }),
          doc({ id: 'b', folderId: 'f-sub' }),
          doc({ id: 'content-only', folderId: 'f-top', fileRef: null }),
        ],
        [
          { id: 'f-top', name: 'Top', parentId: null, teamTags: [] },
          { id: 'f-sub', name: 'Sub', parentId: 'f-top', teamTags: [] },
        ],
      ),
    );

    await handlers['webdav/tree_mutations:copyResource']({
      organizationId: ORG,
      src: { kind: 'folder', id: 'f-top' },
      destParentSegments: [],
      destName: 'Top copy',
      overwrite: false,
      userId: 'u1',
    });

    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0]?.committedBefore).toBe(1);
    expect([...(syncCalls[0]?.refs ?? [])].sort()).toEqual(['s3:a', 's3:b']);
  });

  it('DELETE of a document: the ref it held', async () => {
    const handlers = webdavHandlers(fakeTree([doc({ id: 'gone' })]));

    await handlers['webdav/tree_mutations:softDeleteDocument']({
      organizationId: ORG,
      userId: 'u1',
      documentId: 'gone',
    });

    expect(syncCalls).toEqual([{ refs: ['s3:gone'], committedBefore: 1 }]);
  });

  it('DELETE of a folder: every ref its cascade trashed, and no project file’s', async () => {
    const handlers = webdavHandlers(
      fakeTree(
        [
          doc({ id: 'a', folderId: 'f-top' }),
          doc({ id: 'b', folderId: 'f-sub' }),
          doc({ id: 'project-file', folderId: 'f-top', projectId: 'p-1' }),
          doc({ id: 'already', folderId: 'f-top', lifecycleStatus: 'trashed' }),
        ],
        [
          { id: 'f-top', name: 'Top', parentId: null, teamTags: [] },
          { id: 'f-sub', name: 'Sub', parentId: 'f-top', teamTags: [] },
        ],
      ),
    );

    await handlers['webdav/tree_mutations:deleteFolderCascade']({
      organizationId: ORG,
      userId: 'u1',
      folderId: 'f-top',
    });

    expect(syncCalls).toHaveLength(1);
    expect(syncCalls[0]?.committedBefore).toBe(1);
    expect([...(syncCalls[0]?.refs ?? [])].sort()).toEqual(['s3:a', 's3:b']);
  });

  it('MOVE over an existing document: the ref of the destination it trashed', async () => {
    const handlers = webdavHandlers(
      fakeTree([
        doc({ id: 'mover', title: 'mover.pdf' }),
        doc({ id: 'target', title: 'target.pdf' }),
      ]),
    );

    await handlers['webdav/tree_mutations:moveResource']({
      organizationId: ORG,
      src: { kind: 'document', id: 'mover' },
      srcSegments: ['mover.pdf'],
      destParentSegments: [],
      destName: 'target.pdf',
      overwrite: true,
      userId: 'u1',
    });

    expect(syncCalls).toEqual([{ refs: ['s3:target'], committedBefore: 1 }]);
  });

  it('PUT over an existing document: the old ref it moved off', async () => {
    const handlers = webdavHandlers(
      fakeTree([doc({ id: 'report', title: 'report.pdf' })]),
    );

    await handlers['webdav/tree_mutations:ingestPutBlob']({
      organizationId: ORG,
      pathSegments: ['report.pdf'],
      storageId: 's3:report-v2',
      contentType: 'application/pdf',
      size: 10,
      userId: 'u1',
    });

    expect(syncCalls).toEqual([{ refs: ['s3:report'], committedBefore: 1 }]);
  });

  it('a new document by PUT moves no holder', async () => {
    const handlers = webdavHandlers(fakeTree([]));

    await handlers['webdav/tree_mutations:ingestPutBlob']({
      organizationId: ORG,
      pathSegments: ['fresh.pdf'],
      storageId: 's3:fresh',
      contentType: 'application/pdf',
      size: 10,
      userId: 'u1',
    });

    expect(syncCalls).toEqual([{ refs: [], committedBefore: 1 }]);
  });

  it('re-stamps nothing when the write rolled back', async () => {
    const handlers = webdavHandlers(fakeTree([doc({ id: 'src' })]));

    await expect(
      handlers['webdav/tree_mutations:copyResource']({
        organizationId: ORG,
        src: { kind: 'document', id: 'missing' },
        destParentSegments: [],
        destName: 'copy.pdf',
        overwrite: false,
        userId: 'u1',
      }),
    ).rejects.toMatchObject({ data: { code: 'NOT_FOUND' } });

    expect(syncRagRefHolderScopes).not.toHaveBeenCalled();
  });
});
