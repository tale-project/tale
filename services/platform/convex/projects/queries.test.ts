import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/projects/), mirroring tasks/queries.test.ts.
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

const ORG_A = 'org_a';
const ORG_B = 'org_b';
type T = TestConvex<typeof schema>;

async function seedProject(
  t: T,
  organizationId: string,
): Promise<Id<'projects'>> {
  // Org-wide project (no teamId) — readable by any member, so the only thing
  // standing between the caller and the row is the active-org coherence guard.
  return await t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId,
      name: 'Roadmap',
      createdBy: 'user_1',
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

// The coherence guard short-circuits to null/[] BEFORE the auth check, so a
// cross-org read needs no seeded identity/membership. The matching-org call, by
// contrast, passes the guard and reaches `getAuthContext`, which throws
// `Unauthenticated` with no identity — proving the cross-org null is the guard
// firing, not a blanket null. This is the projects analogue of the
// `canAccessThread` "denies when active-org hint does not match" test (#2170).
describe('projects active-org coherence', () => {
  it('getProject returns null for a project outside the active org', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, ORG_A);

    expect(
      await t.query(api.projects.queries.getProject, {
        projectId,
        organizationId: ORG_B,
      }),
    ).toBeNull();

    // Same project, matching org: guard passes, so we reach the auth check.
    await expect(
      t.query(api.projects.queries.getProject, {
        projectId,
        organizationId: ORG_A,
      }),
    ).rejects.toThrow();
  });

  it('getProjectStats returns null for a project outside the active org', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, ORG_A);

    expect(
      await t.query(api.projects.queries.getProjectStats, {
        projectId,
        organizationId: ORG_B,
      }),
    ).toBeNull();
  });

  it('listProjectDocuments returns [] for a project outside the active org', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, ORG_A);

    expect(
      await t.query(api.projects.queries.listProjectDocuments, {
        projectId,
        organizationId: ORG_B,
      }),
    ).toEqual([]);
  });
});
