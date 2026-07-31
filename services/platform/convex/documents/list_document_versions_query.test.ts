import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'documents';
function toConvexRootKey(globKey: string): string {
  const stack: string[] = [];
  for (const part of `${TEST_DIR_FROM_CONVEX_ROOT}/${globKey}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}
const rawModules = import.meta.glob('../**/*.*s');
const modules: Record<string, () => Promise<unknown>> = {};
for (const [key, loader] of Object.entries(rawModules)) {
  modules[toConvexRootKey(key)] = loader;
}

const ORG = 'org_versions';
const USER = 'user_versions';
const IDENTITY = { subject: USER };
type T = TestConvex<typeof schema>;

async function seedMember(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${USER}_${ORG}`,
      userId: USER,
      organizationId: ORG,
      role: 'member',
      createdAt: 0,
    });
  });
}

async function seedProject(t: T): Promise<Id<'projects'>> {
  return await t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Client',
      createdBy: USER,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

describe('listDocumentVersions', () => {
  it('returns null when unauthenticated', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const docId = await t.run(async (ctx) => {
      const fileId = await ctx.storage.store(
        new Blob(['x'], { type: 'text/x-python' }),
      );
      return await ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'transform.py',
        fileId,
      });
    });
    const result = await t.query(api.documents.queries.listDocumentVersions, {
      documentId: docId,
      organizationId: ORG,
    });
    expect(result).toBeNull();
  });

  it('lists current + history with metadata for a readable project doc', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const projectId = await seedProject(t);

    const { docId, currentStorage, oldStorage } = await t.run(async (ctx) => {
      const current = await ctx.storage.store(
        new Blob(['v2'], { type: 'text/x-python' }),
      );
      const old = await ctx.storage.store(
        new Blob(['v1'], { type: 'text/x-python' }),
      );
      await ctx.db.insert('fileMetadata', {
        organizationId: ORG,
        storageId: current,
        fileName: 'transform.py',
        contentType: 'text/x-python',
        size: 2,
      });
      await ctx.db.insert('fileMetadata', {
        organizationId: ORG,
        storageId: old,
        fileName: 'transform.py',
        contentType: 'text/x-python',
        size: 2,
      });
      const id = await ctx.db.insert('documents', {
        organizationId: ORG,
        projectId,
        title: 'transform.py',
        fileId: current,
        historyFiles: [old],
        externalItemId: `acme:${projectId}:transform.py`,
      });
      return { docId: id, currentStorage: current, oldStorage: old };
    });

    const asUser = t.withIdentity(IDENTITY);
    const result = await asUser.query(
      api.documents.queries.listDocumentVersions,
      { documentId: docId, organizationId: ORG },
    );
    expect(result).not.toBeNull();
    expect(result?.title).toBe('transform.py');
    expect(result?.versions).toHaveLength(2);
    expect(result?.versions[0]?.storageId).toBe(currentStorage);
    expect(result?.versions[0]?.isCurrent).toBe(true);
    expect(result?.versions[0]?.fileName).toBe('transform.py');
    expect(result?.versions[1]?.storageId).toBe(oldStorage);
    expect(result?.versions[1]?.isCurrent).toBe(false);
  });
});

describe('getDocumentByExternalItemId', () => {
  it('resolves an active project document by externalItemId', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const projectId = await seedProject(t);
    const externalItemId = `acme:${projectId}:transform.py`;

    const docId = await t.run(async (ctx) => {
      const storage = await ctx.storage.store(
        new Blob(['code'], { type: 'text/x-python' }),
      );
      const old = await ctx.storage.store(
        new Blob(['old'], { type: 'text/x-python' }),
      );
      return await ctx.db.insert('documents', {
        organizationId: ORG,
        projectId,
        title: 'transform.py',
        fileId: storage,
        historyFiles: [old],
        externalItemId,
      });
    });

    const asUser = t.withIdentity(IDENTITY);
    const result = await asUser.query(
      api.documents.queries.getDocumentByExternalItemId,
      { organizationId: ORG, externalItemId, projectId },
    );
    expect(result).toEqual({
      documentId: docId,
      title: 'transform.py',
      folderId: undefined,
      hasHistory: true,
    });
  });

  it('returns null when projectId does not match', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const projectId = await seedProject(t);
    const otherProject = await seedProject(t);
    const externalItemId = `acme:${projectId}:transform.py`;

    await t.run(async (ctx) => {
      const storage = await ctx.storage.store(
        new Blob(['code'], { type: 'text/x-python' }),
      );
      await ctx.db.insert('documents', {
        organizationId: ORG,
        projectId,
        title: 'transform.py',
        fileId: storage,
        externalItemId,
      });
    });

    const asUser = t.withIdentity(IDENTITY);
    const result = await asUser.query(
      api.documents.queries.getDocumentByExternalItemId,
      {
        organizationId: ORG,
        externalItemId,
        projectId: otherProject,
      },
    );
    expect(result).toBeNull();
  });
});
