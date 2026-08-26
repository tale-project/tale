import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
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

type T = TestConvex<typeof schema>;

const ORG = 'org_palette_documents';
const USER = 'user_palette_documents';

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

describe('searchDocuments', () => {
  it('returns readable hub documents by title', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const documentId = await t.run((ctx) =>
      ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'Quarterly Budget',
        folderPath: '/Finance',
        lifecycleStatus: 'active',
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert('documents', {
        organizationId: ORG,
        title: 'Quarterly Budget Trashed',
        lifecycleStatus: 'trashed',
      }),
    );

    const alice = t.withIdentity({ subject: USER });
    const hits = await alice.query(api.documents.search.searchDocuments, {
      organizationId: ORG,
      query: 'budget',
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.documentId).toBe(documentId);
    expect(hits[0]?.snippet).toBe('/Finance');
  });
});
