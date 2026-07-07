import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// Normalize the module glob to convex/-root-relative keys (see the rationale in
// lock_mutations.test.ts). Kept in this convex-excluded .test.ts file.
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[key.startsWith('../') ? key.slice(3) : `webdav/${key.slice(2)}`] =
    loader;
}

const ORG = 'org_test_tree_queries';
const USER = 'user_1';

type TestCtx = ReturnType<typeof convexTest>;

// Seed a project row + a document attached to it. Project files carry no
// folderId (project uploads never set one), so without the scope filter they
// read as root-level hub documents — the #2545 leak.
async function seedProjectDoc(
  t: TestCtx,
  title: string,
  opts: {
    folderId?: Id<'folders'>;
    lifecycleStatus?: 'active' | 'trashed';
  } = {},
) {
  return await t.run(async (ctx) => {
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Secret Project',
      createdBy: USER,
      createdAt: 0,
      updatedAt: 0,
    });
    const docId = await ctx.db.insert('documents', {
      organizationId: ORG,
      title,
      projectId,
      folderId: opts.folderId,
      lifecycleStatus: opts.lifecycleStatus ?? 'active',
    });
    return { projectId, docId };
  });
}

async function seedHubDoc(t: TestCtx, title: string) {
  return await t.run(async (ctx) =>
    ctx.db.insert('documents', {
      organizationId: ORG,
      title,
      lifecycleStatus: 'active',
    }),
  );
}

// WebDAV is a hub-only surface (#2545): project-scoped documents must be
// invisible to EVERY caller — the Hono-trust split asserts only (org, user),
// so WebDAV cannot evaluate project membership and the rule is uniform
// not-found, mirroring the REST API's opaque 404s. Project members reach
// their files through the project surfaces instead.
describe('webdav tree_queries project-scope visibility (convex-test)', () => {
  it('listCollection at the root excludes project-scoped documents', async () => {
    const t = convexTest(schema, modules);
    await seedProjectDoc(t, 'project-plan.pdf');
    await seedHubDoc(t, 'hub-notes.txt');

    const listing = await t.query(internal.webdav.tree_queries.listCollection, {
      organizationId: ORG,
      namespace: 'documents',
      folderId: null,
    });

    const titles = listing.documents.map((d) => d.title);
    expect(titles).toContain('hub-notes.txt');
    expect(titles).not.toContain('project-plan.pdf');
  });

  it('listCollection inside a folder excludes project-scoped documents', async () => {
    const t = convexTest(schema, modules);
    const folderId = await t.run(async (ctx) =>
      ctx.db.insert('folders', {
        organizationId: ORG,
        name: 'shared',
        createdBy: USER,
      }),
    );
    await seedProjectDoc(t, 'nested-project.md', { folderId });

    const listing = await t.query(internal.webdav.tree_queries.listCollection, {
      organizationId: ORG,
      namespace: 'documents',
      folderId,
    });

    expect(listing.documents).toHaveLength(0);
  });

  it('resolvePath treats a project-scoped document as not_found; hub docs still resolve', async () => {
    const t = convexTest(schema, modules);
    await seedProjectDoc(t, 'project-plan.pdf');
    const hubId = await seedHubDoc(t, 'hub-notes.txt');

    const project = await t.query(internal.webdav.tree_queries.resolvePath, {
      organizationId: ORG,
      namespace: 'documents',
      segments: ['project-plan.pdf'],
    });
    expect(project).toEqual({ kind: 'not_found', exists: false });

    const hub = await t.query(internal.webdav.tree_queries.resolvePath, {
      organizationId: ORG,
      namespace: 'documents',
      segments: ['hub-notes.txt'],
    });
    expect(hub).toEqual({ kind: 'document', documentId: hubId, exists: true });
  });

  it('resolvePath rejects the <title>_<docId> disambiguation form for a project doc', async () => {
    const t = convexTest(schema, modules);
    const { docId } = await seedProjectDoc(t, 'project-plan.pdf');

    const resolved = await t.query(internal.webdav.tree_queries.resolvePath, {
      organizationId: ORG,
      namespace: 'documents',
      segments: [`project-plan.pdf_${docId}`],
    });
    expect(resolved).toEqual({ kind: 'not_found', exists: false });
  });

  it('resolvePath inside a folder treats a project-scoped document as not_found', async () => {
    const t = convexTest(schema, modules);
    const folderId = await t.run(async (ctx) =>
      ctx.db.insert('folders', {
        organizationId: ORG,
        name: 'shared',
        createdBy: USER,
      }),
    );
    await seedProjectDoc(t, 'nested-project.md', { folderId });

    const resolved = await t.query(internal.webdav.tree_queries.resolvePath, {
      organizationId: ORG,
      namespace: 'documents',
      segments: ['shared', 'nested-project.md'],
    });
    expect(resolved).toEqual({ kind: 'not_found', exists: false });
  });

  it('getDocumentProps returns null for a project-scoped document', async () => {
    const t = convexTest(schema, modules);
    const { docId } = await seedProjectDoc(t, 'project-plan.pdf');

    const props = await t.query(internal.webdav.tree_queries.getDocumentProps, {
      organizationId: ORG,
      documentId: docId,
    });
    expect(props).toBeNull();
  });

  it('the .trash namespace neither lists nor resolves a trashed project doc', async () => {
    const t = convexTest(schema, modules);
    await seedProjectDoc(t, 'binned-project.pdf', {
      lifecycleStatus: 'trashed',
    });

    const listing = await t.query(internal.webdav.tree_queries.listCollection, {
      organizationId: ORG,
      namespace: '.trash',
      folderId: null,
    });
    expect(listing.documents).toHaveLength(0);

    const resolved = await t.query(internal.webdav.tree_queries.resolvePath, {
      organizationId: ORG,
      namespace: '.trash',
      segments: ['binned-project.pdf'],
    });
    expect(resolved).toEqual({ kind: 'not_found', exists: false });
  });
});
