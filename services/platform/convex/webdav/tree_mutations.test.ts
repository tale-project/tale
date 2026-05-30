import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import schema from '../schema';

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
