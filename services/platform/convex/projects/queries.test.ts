import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import betterAuthSchema from '../betterAuth/schema';
import schema from '../schema';

// Reviewer display names resolve through the Better Auth component
// (getUserNamesBatch); registered empty — resolution degrading to the bare
// user id is fine here, the projection contract is what's under test.
const authModules = import.meta.glob('../betterAuth/**/*.*s');

/** Pack-declared setup root used in these tests (not a platform constant). */
const SETUP_FOLDER = '_setup';

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
const USER = 'user_1';
const IDENTITY = { subject: USER };
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
      createdBy: USER,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

async function seedMember(t: T, organizationId: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${USER}_${organizationId}`,
      userId: USER,
      organizationId,
      role: 'member',
      createdAt: 0,
    });
  });
}

async function seedFolder(
  t: T,
  args: {
    organizationId: string;
    projectId: Id<'projects'>;
    name: string;
    parentId?: Id<'folders'>;
  },
): Promise<Id<'folders'>> {
  return await t.run((ctx) =>
    ctx.db.insert('folders', {
      organizationId: args.organizationId,
      projectId: args.projectId,
      name: args.name,
      ...(args.parentId ? { parentId: args.parentId } : {}),
      createdBy: USER,
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

  it('listProjectRootFolders returns [] for a project outside the active org', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, ORG_A);

    expect(
      await t.query(api.projects.queries.listProjectRootFolders, {
        projectId,
        organizationId: ORG_B,
      }),
    ).toEqual([]);
  });

  it('getProjectSetupFolder returns null for a project outside the active org', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, ORG_A);

    expect(
      await t.query(api.projects.queries.getProjectSetupFolder, {
        projectId,
        organizationId: ORG_B,
        setupFolderName: SETUP_FOLDER,
      }),
    ).toBeNull();
  });
});

describe('listProjectRootFolders', () => {
  it('returns top-level folders excluding the named setup folder and nested children', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG_A);
    const projectId = await seedProject(t, ORG_A);

    const setupId = await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: SETUP_FOLDER,
    });
    const q1Id = await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: '2026-Q1',
    });
    await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: '2026-Q2',
    });
    await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: 'nested',
      parentId: q1Id,
    });
    // Nested under setup must not leak as a root either.
    await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: 'transform',
      parentId: setupId,
    });

    const roots = await t
      .withIdentity(IDENTITY)
      .query(api.projects.queries.listProjectRootFolders, {
        projectId,
        organizationId: ORG_A,
        setupFolderName: SETUP_FOLDER,
      });

    expect(roots.map((f) => f.name).sort()).toEqual(['2026-Q1', '2026-Q2']);
    expect(roots.every((f) => f.name !== SETUP_FOLDER)).toBe(true);
    expect(roots.every((f) => f.setupFolderId === setupId)).toBe(true);
    expect(roots.every((f) => !f.hasTask)).toBe(true);
  });

  it('marks hasTask when a project task exists for the folder under externalSystem', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG_A);
    const projectId = await seedProject(t, ORG_A);
    await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: SETUP_FOLDER,
    });
    const q1Id = await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: '2026-Q1',
    });
    const q2Id = await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: '2026-Q2',
    });
    await t.run((ctx) =>
      ctx.db.insert('tasks', {
        organizationId: ORG_A,
        projectId,
        title: 'Period job — 2026Q1',
        status: 'done',
        rank: 'a0',
        number: 1,
        createdBy: USER,
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
        externalSystem: 'pack-a',
        externalId: q1Id,
      }),
    );

    const roots = await t
      .withIdentity(IDENTITY)
      .query(api.projects.queries.listProjectRootFolders, {
        projectId,
        organizationId: ORG_A,
        setupFolderName: SETUP_FOLDER,
        externalSystem: 'pack-a',
      });

    const byName = Object.fromEntries(roots.map((f) => [f.name, f]));
    expect(byName['2026-Q1']?.hasTask).toBe(true);
    expect(byName['2026-Q2']?.hasTask).toBe(false);
    expect(byName['2026-Q1']?._id).toBe(q1Id);
    expect(byName['2026-Q2']?._id).toBe(q2Id);
  });

  it('leaves hasTask false when externalSystem is omitted even if tasks exist', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG_A);
    const projectId = await seedProject(t, ORG_A);
    const q1Id = await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: '2026-Q1',
    });
    await t.run((ctx) =>
      ctx.db.insert('tasks', {
        organizationId: ORG_A,
        projectId,
        title: 'Return',
        status: 'in_review',
        rank: 'a0',
        number: 1,
        createdBy: USER,
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
        externalSystem: 'pack-a',
        externalId: q1Id,
      }),
    );

    const roots = await t
      .withIdentity(IDENTITY)
      .query(api.projects.queries.listProjectRootFolders, {
        projectId,
        organizationId: ORG_A,
      });

    expect(roots).toHaveLength(1);
    expect(roots[0]?.hasTask).toBe(false);
  });

  it('returns every root with null setupFolderId when setupFolderName is omitted', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG_A);
    const projectId = await seedProject(t, ORG_A);
    await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: SETUP_FOLDER,
    });
    await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: '2026-Q1',
    });

    const roots = await t
      .withIdentity(IDENTITY)
      .query(api.projects.queries.listProjectRootFolders, {
        projectId,
        organizationId: ORG_A,
      });

    expect(roots.map((f) => f.name).sort()).toEqual(['2026-Q1', SETUP_FOLDER]);
    expect(roots.every((f) => f.setupFolderId === null)).toBe(true);
  });

  it('returns setupFolderId null when the named setup folder is absent', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG_A);
    const projectId = await seedProject(t, ORG_A);
    await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: '2026-Q1',
    });
    await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: '2026-Q2',
    });

    const roots = await t
      .withIdentity(IDENTITY)
      .query(api.projects.queries.listProjectRootFolders, {
        projectId,
        organizationId: ORG_A,
        setupFolderName: SETUP_FOLDER,
      });

    expect(roots.map((f) => f.name).sort()).toEqual(['2026-Q1', '2026-Q2']);
    expect(roots.every((f) => f.setupFolderId === null)).toBe(true);
  });
});

describe('getProjectSetupFolder', () => {
  it('returns the named top-level setup folder when present', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG_A);
    const projectId = await seedProject(t, ORG_A);
    const setupId = await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: SETUP_FOLDER,
    });

    const setup = await t
      .withIdentity(IDENTITY)
      .query(api.projects.queries.getProjectSetupFolder, {
        projectId,
        organizationId: ORG_A,
        setupFolderName: SETUP_FOLDER,
      });

    expect(setup).toEqual({
      _id: setupId,
      name: SETUP_FOLDER,
    });
  });

  it('returns null when the named setup folder is absent', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG_A);
    const projectId = await seedProject(t, ORG_A);
    await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: '2026-Q1',
    });

    expect(
      await t
        .withIdentity(IDENTITY)
        .query(api.projects.queries.getProjectSetupFolder, {
          projectId,
          organizationId: ORG_A,
          setupFolderName: SETUP_FOLDER,
        }),
    ).toBeNull();
  });

  it('returns null when setupFolderName is blank', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG_A);
    const projectId = await seedProject(t, ORG_A);
    await seedFolder(t, {
      organizationId: ORG_A,
      projectId,
      name: SETUP_FOLDER,
    });

    expect(
      await t
        .withIdentity(IDENTITY)
        .query(api.projects.queries.getProjectSetupFolder, {
          projectId,
          organizationId: ORG_A,
          setupFolderName: '   ',
        }),
    ).toBeNull();
  });
});

// The Files tab's record badge + lifecycle menu read this projection — a
// controlled document must surface state/version/CAS token, an uncontrolled
// one must stay bare (no `record` key at all).
describe('listProjectDocuments controlled-record projection', () => {
  it('projects record state, version, currentFileId and reviewer', async () => {
    const t = convexTest(schema, modules);
    t.registerComponent('betterAuth', betterAuthSchema, authModules);
    await seedMember(t, ORG_A);
    const projectId = await seedProject(t, ORG_A);
    const fileId = await t.run((ctx) =>
      ctx.storage.store(new Blob(['controlled bytes'])),
    );

    await t.run(async (ctx) => {
      await ctx.db.insert('documents', {
        organizationId: ORG_A,
        projectId,
        title: 'plain.txt',
        sourceProvider: 'upload',
        createdBy: USER,
      });
      await ctx.db.insert('documents', {
        organizationId: ORG_A,
        projectId,
        title: 'sop.txt',
        sourceProvider: 'upload',
        createdBy: USER,
        fileId,
        record: {
          state: 'in_review',
          version: 3,
          controlledAt: 0,
          controlledBy: USER,
          reviewerUserId: 'u_reviewer',
          approvedVersions: [],
        },
      });
    });

    const rows = await t
      .withIdentity(IDENTITY)
      .query(api.projects.queries.listProjectDocuments, {
        projectId,
        organizationId: ORG_A,
      });

    const byTitle = Object.fromEntries(rows.map((r) => [r.title, r]));
    expect(byTitle['plain.txt']).toBeDefined();
    expect(byTitle['plain.txt']?.record).toBeUndefined();
    expect(byTitle['sop.txt']?.record).toEqual({
      state: 'in_review',
      version: 3,
      currentFileId: String(fileId),
      reviewerUserId: 'u_reviewer',
    });
  });
});
