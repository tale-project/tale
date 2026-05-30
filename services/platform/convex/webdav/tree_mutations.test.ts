import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

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
  it('recomputes descendant folderPath and detaches integration-sourced docs (P2.3)', async () => {
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
});
