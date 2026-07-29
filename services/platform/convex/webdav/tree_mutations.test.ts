import { convexTest } from 'convex-test';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';

// ingestPutBlob → saveFileMetadata gates an opportunistic retention-cleanup
// schedule behind the rate-limiter component, which convex-test can't resolve
// (no component registration in this suite). That gate is orthogonal to the
// content-type behaviour under test, so stub the helper to a no-op while
// preserving the error type the caller branches on.
vi.mock('../lib/rate_limiter/helpers', () => ({
  checkOrganizationRateLimit: vi.fn(async () => undefined),
  RateLimitExceededError: class RateLimitExceededError extends Error {},
}));

// Normalize the module glob to convex/-root-relative keys (see the rationale in
// lock_mutations.test.ts). Kept in this convex-excluded .test.ts file.
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[key.startsWith('../') ? key.slice(3) : `webdav/${key.slice(2)}`] =
    loader;
}

// The mutations under test warn on the storage-delete paths this suite drives
// on purpose (a blob that is already gone), and the work that warns can still
// be in flight when the file's last test returns — a scheduled reclaim action,
// an opportunistic cleanup. Each warn reaches the runner as a console-log RPC,
// and one still pending when the worker tears down fails the WHOLE run with
// `Closing rpc while "onUserConsoleLog" was pending`, which says nothing about
// what is asserted here.
//
// So the swallow is installed for the file's entire lifetime and deliberately
// NOT restored in `afterAll`: restoring it re-opens exactly the window this
// closes — a straggler warn landing after the last hook, with nothing left to
// absorb it. The environment is per-file (`isolate` is on for this project),
// so the real console comes back with the next file either way.
beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

const ORG = 'org_test_tree';
const USER = 'user_1';

type TestCtx = ReturnType<typeof convexTest>;

// Return type inferred from the generated API so `folderId` is Id<'folders'>.
async function mkcol(t: TestCtx, parentSegments: string[], name: string) {
  return await t.mutation(internal.webdav.tree_mutations.mkcol, {
    organizationId: ORG,
    parentSegments,
    name,
    userId: USER,
  });
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toThrow(new RegExp(code));
}

describe('webdav tree_mutations.mkcol (convex-test)', () => {
  it('creates a top-level collection, then 405s on a repeat (already exists)', async () => {
    const t = convexTest(schema, modules);
    const { folderId } = await mkcol(t, [], 'docs');
    expect(folderId).toBeTruthy();
    await expectCode(mkcol(t, [], 'docs'), 'METHOD_NOT_ALLOWED');
  });

  it('405s when a DOCUMENT of the same name already exists (P2.1 collision)', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'report',
        lifecycleStatus: 'active',
      });
    });
    // findCollision must see the document, not just folders.
    await expectCode(mkcol(t, [], 'report'), 'METHOD_NOT_ALLOWED');
  });

  it('409s past MAX_FOLDER_DEPTH (P2.5 depth cap)', async () => {
    const t = convexTest(schema, modules);
    // parentSegments.length + 1 > 20 → rejected before any DB lookup.
    await expectCode(
      mkcol(
        t,
        Array.from({ length: 20 }, () => 'a'),
        'tooDeep',
      ),
      'CONFLICT',
    );
  });

  it('409s when the parent collection does not exist', async () => {
    const t = convexTest(schema, modules);
    await expectCode(mkcol(t, ['missing'], 'child'), 'CONFLICT');
  });
});

describe('webdav tree_mutations legal-hold gate (convex-test)', () => {
  it('softDeleteDocument refuses under an active org hold (P1.2) and leaves the doc active', async () => {
    const t = convexTest(schema, modules);
    const docId = await t.run(async (ctx) => {
      await ctx.db.insert('legalHolds', {
        organizationId: ORG,
        targetType: 'org',
        targetId: ORG,
        targetLabel: 'Test Org',
        reason: 'litigation',
        placedBy: 'admin',
        placedAt: 0,
      });
      return ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'frozen.txt',
        lifecycleStatus: 'active',
      });
    });
    await expectCode(
      t.mutation(internal.webdav.tree_mutations.softDeleteDocument, {
        organizationId: ORG,
        documentId: docId,
      }),
      'LEGAL_HOLD_ACTIVE',
    );
    const doc = await t.run(async (ctx) => ctx.db.get(docId));
    expect(doc?.lifecycleStatus).toBe('active');
  });

  it('softDeleteDocument succeeds with no hold', async () => {
    const t = convexTest(schema, modules);
    const docId = await t.run(async (ctx) =>
      ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'ok.txt',
        lifecycleStatus: 'active',
      }),
    );
    await t.mutation(internal.webdav.tree_mutations.softDeleteDocument, {
      organizationId: ORG,
      documentId: docId,
    });
    const doc = await t.run(async (ctx) => ctx.db.get(docId));
    expect(doc?.lifecycleStatus).toBe('trashed');
  });
});

describe('webdav tree_mutations.moveResource folder reparent (convex-test)', () => {
  it('recomputes descendant folderPath and detaches connector-sourced docs (P2.3)', async () => {
    const t = convexTest(schema, modules);
    const { folderId: srcId } = await mkcol(t, [], 'src');
    await mkcol(t, [], 'dst');
    const docId = await t.run(async (ctx) =>
      ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'synced.txt',
        folderId: srcId,
        lifecycleStatus: 'active',
        sourceProvider: 'onedrive',
        externalItemId: 'ext-1',
        folderPath: '/src',
      }),
    );

    // Move folder "src" under "dst" (keeping the name).
    await t.mutation(internal.webdav.tree_mutations.moveResource, {
      organizationId: ORG,
      src: { kind: 'folder', id: srcId },
      srcSegments: ['src'],
      destParentSegments: ['dst'],
      destName: 'src',
      overwrite: false,
      userId: USER,
    });

    const doc = await t.run(async (ctx) => ctx.db.get(docId));
    // Descendant detached from its external sync binding...
    expect(doc?.sourceProvider).toBeUndefined();
    expect(doc?.externalItemId).toBeUndefined();
    // ...and its denormalized folderPath recomputed (no longer the stale "/src").
    expect(doc?.folderPath).not.toBe('/src');
    expect(doc?.folderPath).toContain('dst');
  });
});

describe('webdav tree_mutations.ingestPutBlob content-type derivation (convex-test)', () => {
  const PPTX_MIME =
    'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  // WebDAV clients (GVfs/davfs2) PUT with a generic application/octet-stream
  // Content-Type. ingestPutBlob must derive the real MIME from the filename so
  // remote file managers render the right icon and the stored type matches the
  // web upload path. Regression guard for the blank-icon bug.
  async function ingest(
    t: TestCtx,
    fileName: string,
    clientContentType: string,
  ) {
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['x'], { type: clientContentType })),
    );
    const result = await t.mutation(
      internal.webdav.tree_mutations.ingestPutBlob,
      {
        organizationId: ORG,
        pathSegments: [fileName],
        storageId,
        contentType: clientContentType,
        size: 1,
        userId: USER,
      },
    );
    const doc = await t.run(async (ctx) => ctx.db.get(result.documentId));
    const fm = await t.run(async (ctx) => {
      const rows = await ctx.db.query('fileMetadata').collect();
      return rows.find((r) => r.storageId === storageId) ?? null;
    });
    return { result, mimeType: doc?.mimeType, contentType: fm?.contentType };
  }

  it('rewrites octet-stream to application/pdf for a .pdf upload', async () => {
    const t = convexTest(schema, modules);
    const { result, mimeType, contentType } = await ingest(
      t,
      'report.pdf',
      'application/octet-stream',
    );
    expect(result.created).toBe(true);
    expect(mimeType).toBe('application/pdf');
    expect(contentType).toBe('application/pdf');
  });

  it('rewrites octet-stream to the Office MIME for a .pptx upload', async () => {
    const t = convexTest(schema, modules);
    const { mimeType, contentType } = await ingest(
      t,
      'deck.pptx',
      'application/octet-stream',
    );
    expect(mimeType).toBe(PPTX_MIME);
    expect(contentType).toBe(PPTX_MIME);
  });

  it('preserves a correct client-supplied Content-Type', async () => {
    const t = convexTest(schema, modules);
    const { mimeType } = await ingest(t, 'photo.png', 'image/png');
    expect(mimeType).toBe('image/png');
  });

  it('labels a markdown file (.md) as text/markdown instead of octet-stream', async () => {
    const t = convexTest(schema, modules);
    const { mimeType, contentType } = await ingest(
      t,
      'practice.md',
      'application/octet-stream',
    );
    expect(mimeType).toBe('text/markdown');
    expect(contentType).toBe('text/markdown');
  });

  it('leaves an unknown binary extension as octet-stream', async () => {
    const t = convexTest(schema, modules);
    const { mimeType } = await ingest(
      t,
      'firmware.bin',
      'application/octet-stream',
    );
    expect(mimeType).toBe('application/octet-stream');
  });

  it('a second PUT to the same path overwrites in place (created:false)', async () => {
    const t = convexTest(schema, modules);
    const first = await ingest(t, 'dup.txt', 'text/plain');
    expect(first.result.created).toBe(true);
    const second = await ingest(t, 'dup.txt', 'text/plain');
    expect(second.result.created).toBe(false);
    // Still exactly one active document at that path — not a duplicate row.
    const active = await t.run(async (ctx) => {
      const rows = await ctx.db.query('documents').collect();
      return rows.filter(
        (r) =>
          r.title === 'dup.txt' && (r.lifecycleStatus ?? 'active') === 'active',
      );
    });
    expect(active).toHaveLength(1);
  });
});

describe('webdav tree_mutations.copyResource (convex-test)', () => {
  it('copies a document into a new row sharing the storage id; source stays active', async () => {
    const t = convexTest(schema, modules);
    const { srcDocId, storageId } = await t.run(async (ctx) => {
      const sid = await ctx.storage.store(new Blob(['x']));
      const id = await ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'orig.txt',
        fileId: sid,
        lifecycleStatus: 'active',
      });
      return { srcDocId: id, storageId: sid };
    });

    const result = await t.mutation(
      internal.webdav.tree_mutations.copyResource,
      {
        organizationId: ORG,
        src: { kind: 'document', id: srcDocId },
        destParentSegments: [],
        destName: 'copy.txt',
        overwrite: false,
        userId: USER,
      },
    );
    expect(result.created).toBe(true);

    const docs = await t.run(async (ctx) =>
      ctx.db.query('documents').collect(),
    );
    const src = docs.find((d) => d._id === srcDocId);
    const copy = docs.find((d) => d.title === 'copy.txt');
    expect(src?.lifecycleStatus).toBe('active'); // source untouched
    expect(copy).toBeTruthy();
    expect(copy?.fileId).toBe(storageId); // content-addressed: same blob
  });

  it('copies a folder recursively, duplicating child documents', async () => {
    const t = convexTest(schema, modules);
    const { folderId: srcId } = await mkcol(t, [], 'src');
    await t.run(async (ctx) =>
      ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'child.txt',
        folderId: srcId,
        lifecycleStatus: 'active',
      }),
    );

    await t.mutation(internal.webdav.tree_mutations.copyResource, {
      organizationId: ORG,
      src: { kind: 'folder', id: srcId },
      destParentSegments: [],
      destName: 'dst',
      overwrite: false,
      userId: USER,
    });

    const folders = await t.run(async (ctx) =>
      ctx.db.query('folders').collect(),
    );
    expect(folders.map((f) => f.name).sort()).toEqual(['dst', 'src']);
    const docs = await t.run(async (ctx) =>
      ctx.db.query('documents').collect(),
    );
    // The child document now exists under both the source and the copy.
    expect(docs.filter((d) => d.title === 'child.txt')).toHaveLength(2);
  });

  it('refuses to copy onto an existing destination without Overwrite (DEST_EXISTS)', async () => {
    const t = convexTest(schema, modules);
    const srcId = await t.run(async (ctx) =>
      ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'a.txt',
        lifecycleStatus: 'active',
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'b.txt',
        lifecycleStatus: 'active',
      }),
    );
    await expectCode(
      t.mutation(internal.webdav.tree_mutations.copyResource, {
        organizationId: ORG,
        src: { kind: 'document', id: srcId },
        destParentSegments: [],
        destName: 'b.txt',
        overwrite: false,
        userId: USER,
      }),
      'DEST_EXISTS',
    );
  });
});

// WebDAV is a hub-only surface (#2545): project-scoped documents
// (documents.projectId set) must behave as not-found for every caller —
// never overwritten by a colliding PUT, never deleted/moved/copied.
describe('webdav tree_mutations project-scope gate (convex-test)', () => {
  async function seedProjectDoc(t: TestCtx, title: string) {
    return await t.run(async (ctx) => {
      const projectId = await ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Secret Project',
        createdBy: USER,
        createdAt: 0,
        updatedAt: 0,
      });
      const storageId = await ctx.storage.store(new Blob(['project bytes']));
      const docId = await ctx.db.insert('documents', {
        organizationId: ORG,
        title,
        projectId,
        fileId: storageId,
        lifecycleStatus: 'active',
      });
      return { projectId, docId, storageId };
    });
  }

  it('a PUT colliding with a project file creates an independent hub doc and leaves the project blob untouched', async () => {
    const t = convexTest(schema, modules);
    const { docId, storageId } = await seedProjectDoc(t, 'spec.pdf');

    const putStorageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['hub bytes'], { type: 'application/pdf' })),
    );
    const result = await t.mutation(
      internal.webdav.tree_mutations.ingestPutBlob,
      {
        organizationId: ORG,
        pathSegments: ['spec.pdf'],
        storageId: putStorageId,
        contentType: 'application/pdf',
        size: 9,
        userId: USER,
      },
    );

    // New hub row, not a bind to the project row...
    expect(result.created).toBe(true);
    expect(result.documentId).not.toBe(docId);
    // ...and the project doc's row + blob are untouched.
    const projectDoc = await t.run(async (ctx) => ctx.db.get(docId));
    expect(projectDoc?.fileId).toBe(storageId);
    expect(projectDoc?.lifecycleStatus).toBe('active');
    const blobStillStored = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(storageId);
      return blob !== null;
    });
    expect(blobStillStored).toBe(true);
  });

  it('softDeleteDocument refuses a project doc as NOT_FOUND and leaves it active', async () => {
    const t = convexTest(schema, modules);
    const { docId } = await seedProjectDoc(t, 'spec.pdf');

    await expectCode(
      t.mutation(internal.webdav.tree_mutations.softDeleteDocument, {
        organizationId: ORG,
        documentId: docId,
      }),
      'NOT_FOUND',
    );
    const doc = await t.run(async (ctx) => ctx.db.get(docId));
    expect(doc?.lifecycleStatus).toBe('active');
  });

  it('moveResource refuses a project doc source as NOT_FOUND and leaves the row unchanged', async () => {
    const t = convexTest(schema, modules);
    const { docId } = await seedProjectDoc(t, 'spec.pdf');

    await expectCode(
      t.mutation(internal.webdav.tree_mutations.moveResource, {
        organizationId: ORG,
        src: { kind: 'document', id: docId },
        srcSegments: ['spec.pdf'],
        destParentSegments: [],
        destName: 'renamed.pdf',
        overwrite: false,
        userId: USER,
      }),
      'NOT_FOUND',
    );
    const doc = await t.run(async (ctx) => ctx.db.get(docId));
    expect(doc?.title).toBe('spec.pdf');
  });

  it('copyResource refuses a project doc source as NOT_FOUND', async () => {
    const t = convexTest(schema, modules);
    const { docId } = await seedProjectDoc(t, 'spec.pdf');

    await expectCode(
      t.mutation(internal.webdav.tree_mutations.copyResource, {
        organizationId: ORG,
        src: { kind: 'document', id: docId },
        destParentSegments: [],
        destName: 'copy.pdf',
        overwrite: false,
        userId: USER,
      }),
      'NOT_FOUND',
    );
    const copies = await t.run(async (ctx) => {
      const rows = await ctx.db.query('documents').collect();
      return rows.filter((r) => r.title === 'copy.pdf');
    });
    expect(copies).toHaveLength(0);
  });

  it('a MOVE whose destination name collides with a project file never trashes the project doc', async () => {
    const t = convexTest(schema, modules);
    const { docId } = await seedProjectDoc(t, 'spec.pdf');
    const hubId = await t.run(async (ctx) =>
      ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'draft.pdf',
        lifecycleStatus: 'active',
      }),
    );

    // Overwrite:true against an invisible project doc must not resolve it as
    // the collision target — the project row stays active.
    const result = await t.mutation(
      internal.webdav.tree_mutations.moveResource,
      {
        organizationId: ORG,
        src: { kind: 'document', id: hubId },
        srcSegments: ['draft.pdf'],
        destParentSegments: [],
        destName: 'spec.pdf',
        overwrite: true,
        userId: USER,
      },
    );
    expect(result.created).toBe(true); // no visible collision
    const projectDoc = await t.run(async (ctx) => ctx.db.get(docId));
    expect(projectDoc?.lifecycleStatus).toBe('active');
  });

  it('MKCOL is not blocked by an invisible project doc of the same name', async () => {
    const t = convexTest(schema, modules);
    await seedProjectDoc(t, 'reports');
    const { folderId } = await mkcol(t, [], 'reports');
    expect(folderId).toBeTruthy();
  });
});

// Project-scoped FOLDERS are excluded the same way as project docs: the
// hub-exact index (`by_org_project_parent_name` pinned to
// projectId=undefined) keeps them out of listings/path segments/collision
// checks, and the id-level `assertVisibleFolderSrc` gate refuses raw ids.
describe('webdav tree_mutations project-folder gate (convex-test)', () => {
  async function seedProjectFolder(t: TestCtx, name: string) {
    return await t.run(async (ctx) => {
      const projectId = await ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Secret Project',
        createdBy: USER,
        createdAt: 0,
        updatedAt: 0,
      });
      const folderId = await ctx.db.insert('folders', {
        organizationId: ORG,
        name,
        projectId,
      });
      return { projectId, folderId };
    });
  }

  it('MKCOL colliding with a project folder creates an independent hub folder', async () => {
    const t = convexTest(schema, modules);
    const { folderId: projectFolderId } = await seedProjectFolder(t, 'reports');
    const { folderId } = await mkcol(t, [], 'reports');
    expect(folderId).toBeTruthy();
    expect(folderId).not.toBe(projectFolderId);
    // The project folder is untouched.
    const projectFolder = await t.run(async (ctx) =>
      ctx.db.get(projectFolderId),
    );
    expect(projectFolder?.projectId).toBeTruthy();
  });

  it('a PUT path never traverses a project folder — the invisible parent 409s', async () => {
    const t = convexTest(schema, modules);
    const { folderId: projectFolderId } = await seedProjectFolder(t, 'reports');
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['hub bytes'], { type: 'text/plain' })),
    );
    // PUT does not auto-vivify parents (RFC 4918: the client MKCOLs first);
    // a parent segment that only exists as a project folder must read as
    // missing — CONFLICT — rather than routing the write into the project.
    await expectCode(
      t.mutation(internal.webdav.tree_mutations.ingestPutBlob, {
        organizationId: ORG,
        pathSegments: ['reports', 'notes.txt'],
        storageId,
        contentType: 'text/plain',
        size: 9,
        userId: USER,
      }),
      'CONFLICT',
    );
    // Nothing landed inside the project folder.
    const projectChildren = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('documents')
        .withIndex('by_organizationId_and_folderId', (q) =>
          q.eq('organizationId', ORG).eq('folderId', projectFolderId),
        )
        .collect();
      return rows;
    });
    expect(projectChildren).toHaveLength(0);
  });

  it('deleteFolderCascade refuses a project folder id as NOT_FOUND', async () => {
    const t = convexTest(schema, modules);
    const { folderId } = await seedProjectFolder(t, 'reports');
    await expectCode(
      t.mutation(internal.webdav.tree_mutations.deleteFolderCascade, {
        organizationId: ORG,
        folderId,
      }),
      'NOT_FOUND',
    );
    const folder = await t.run(async (ctx) => ctx.db.get(folderId));
    expect(folder).not.toBeNull();
  });

  it('moveResource refuses a project folder src as NOT_FOUND', async () => {
    const t = convexTest(schema, modules);
    const { folderId } = await seedProjectFolder(t, 'reports');
    await expectCode(
      t.mutation(internal.webdav.tree_mutations.moveResource, {
        organizationId: ORG,
        src: { kind: 'folder', id: folderId },
        srcSegments: ['reports'],
        destParentSegments: [],
        destName: 'renamed',
        overwrite: false,
        userId: USER,
      }),
      'NOT_FOUND',
    );
    const folder = await t.run(async (ctx) => ctx.db.get(folderId));
    expect(folder?.name).toBe('reports');
  });

  it('copyResource refuses a project folder src as NOT_FOUND', async () => {
    const t = convexTest(schema, modules);
    const { folderId } = await seedProjectFolder(t, 'reports');
    await expectCode(
      t.mutation(internal.webdav.tree_mutations.copyResource, {
        organizationId: ORG,
        src: { kind: 'folder', id: folderId },
        destParentSegments: [],
        destName: 'copy',
        overwrite: false,
        userId: USER,
      }),
      'NOT_FOUND',
    );
    const copies = await t.run(async (ctx) => {
      const rows = await ctx.db.query('folders').collect();
      return rows.filter((r) => r.name === 'copy');
    });
    expect(copies).toHaveLength(0);
  });

  it('a MOVE destination colliding with a project folder is not a collision', async () => {
    const t = convexTest(schema, modules);
    const { folderId: projectFolderId } = await seedProjectFolder(t, 'reports');
    const { folderId: hubId } = await mkcol(t, [], 'drafts');
    // Overwrite:false — an invisible project folder must not DEST_EXISTS.
    const result = await t.mutation(
      internal.webdav.tree_mutations.moveResource,
      {
        organizationId: ORG,
        src: { kind: 'folder', id: hubId },
        srcSegments: ['drafts'],
        destParentSegments: [],
        destName: 'reports',
        overwrite: false,
        userId: USER,
      },
    );
    expect(result.created).toBe(true);
    const projectFolder = await t.run(async (ctx) =>
      ctx.db.get(projectFolderId),
    );
    expect(projectFolder?.name).toBe('reports');
  });
});

describe('webdav tree_mutations.deleteFolderCascade (convex-test)', () => {
  it('trashes every descendant document and removes the folder rows', async () => {
    const t = convexTest(schema, modules);
    const { folderId: parent } = await mkcol(t, [], 'parent');
    const { folderId: child } = await mkcol(t, ['parent'], 'child');
    const docId = await t.run(async (ctx) =>
      ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'deep.txt',
        folderId: child,
        lifecycleStatus: 'active',
      }),
    );

    await t.mutation(internal.webdav.tree_mutations.deleteFolderCascade, {
      organizationId: ORG,
      folderId: parent,
    });

    const doc = await t.run(async (ctx) => ctx.db.get(docId));
    expect(doc?.lifecycleStatus).toBe('trashed');
    const folders = await t.run(async (ctx) =>
      ctx.db.query('folders').collect(),
    );
    expect(folders).toHaveLength(0); // both parent + child folder rows gone
  });

  it('refuses the cascade under an org legal hold, leaving the subtree intact', async () => {
    const t = convexTest(schema, modules);
    const { folderId: parent } = await mkcol(t, [], 'held');
    const docId = await t.run(async (ctx) => {
      await ctx.db.insert('legalHolds', {
        organizationId: ORG,
        targetType: 'org',
        targetId: ORG,
        targetLabel: 'Test Org',
        reason: 'litigation',
        placedBy: 'admin',
        placedAt: 0,
      });
      return ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'frozen.txt',
        folderId: parent,
        lifecycleStatus: 'active',
      });
    });

    await expectCode(
      t.mutation(internal.webdav.tree_mutations.deleteFolderCascade, {
        organizationId: ORG,
        folderId: parent,
      }),
      'LEGAL_HOLD_ACTIVE',
    );
    const doc = await t.run(async (ctx) => ctx.db.get(docId));
    expect(doc?.lifecycleStatus).toBe('active'); // pre-walk refused before trashing
  });
});

describe('webdav tree_mutations — per-org blob seam (s3: refs, #2737)', () => {
  it('ingestPutBlob accepts an s3: ref: fileId is the ref, no Convex sha256', async () => {
    const t = convexTest(schema, modules);
    const s3Ref = `s3:${ORG}/uuid-webdav-1`;
    const result = await t.mutation(
      internal.webdav.tree_mutations.ingestPutBlob,
      {
        organizationId: ORG,
        pathSegments: ['from-webdav.pdf'],
        // A BYO-bucket org's WebDAV PUT lands the bytes in S3; the ref is the
        // object key, not a Convex `_storage` id.
        storageId: s3Ref,
        contentType: 'application/pdf',
        size: 2048,
        userId: USER,
      },
    );
    expect(result.created).toBe(true);
    const doc = await t.run(async (ctx) => ctx.db.get(result.documentId));
    expect(doc?.fileId).toBe(s3Ref);
    // S3 blobs have no Convex-computed hash — contentHash must stay undefined
    // (change detection falls back to size/mtime), never crash on the missing
    // `_storage` object.
    expect(doc?.contentHash).toBeUndefined();
    const fm = await t.run(async (ctx) => {
      const rows = await ctx.db.query('fileMetadata').collect();
      return rows.find((r) => r.storageId === s3Ref) ?? null;
    });
    expect(fm?.storageId).toBe(s3Ref);
  });

  it('deleteWebdavBlob schedules the S3 delete action for an s3: ref', async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.webdav.tree_mutations.deleteWebdavBlob, {
      storageId: `s3:${ORG}/orphan-1`,
      organizationId: ORG,
    });
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    expect(scheduled.some((s) => s.name.includes('deleteOrgBlobs'))).toBe(true);
    // Let the scheduled action run to completion HERE. It has no S3 to reach
    // and logs on its way out; left in flight it logs after the file is done,
    // and a console RPC still open at worker teardown fails the whole run with
    // `Closing rpc while "onUserConsoleLog" was pending`.
    await t.finishInProgressScheduledFunctions();
  });

  it('deleteWebdavBlob deletes a Convex _storage ref inline (no schedule)', async () => {
    const t = convexTest(schema, modules);
    const id = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(['y'], { type: 'text/plain' })),
    );
    await t.mutation(internal.webdav.tree_mutations.deleteWebdavBlob, {
      storageId: id,
    });
    const gone = await t.run(async (ctx) => ctx.storage.getUrl(id));
    expect(gone).toBeNull();
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    expect(scheduled.some((s) => s.name.includes('deleteOrgBlobs'))).toBe(
      false,
    );
  });
});
