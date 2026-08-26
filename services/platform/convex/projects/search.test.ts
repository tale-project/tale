import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'projects';
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

const ORG = 'org_palette_projects';
const USER = 'user_palette_projects';

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

describe('searchProjects', () => {
  it('returns readable projects matching name or key', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t);
    const projectId = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Recruitment Ads',
        key: 'REC',
        description: 'Facebook campaigns',
        createdBy: USER,
        createdAt: 0,
        updatedAt: 10,
      }),
    );
    await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Other',
        createdBy: USER,
        createdAt: 0,
        updatedAt: 1,
        archivedAt: 1,
      }),
    );

    const alice = t.withIdentity({ subject: USER });
    const byName = await alice.query(api.projects.search.searchProjects, {
      organizationId: ORG,
      query: 'recruitment',
    });
    expect(byName).toHaveLength(1);
    expect(byName[0]?.projectId).toBe(projectId);
    expect(byName[0]?.key).toBe('REC');

    const byKey = await alice.query(api.projects.search.searchProjects, {
      organizationId: ORG,
      query: 'rec',
    });
    expect(byKey.some((hit) => hit.projectId === projectId)).toBe(true);
  });
});
