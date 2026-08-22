// The externalItemId contract: an opaque caller-owned external key on
// projects, org-unique regardless of lifecycle, stored trimmed, never
// interpreted by the platform, and never cloned by duplication. Also pins the
// projectRowValidator regression: list/get spread whole docs, so a schema
// field missing from that validator would make them throw at runtime for rows
// carrying the field.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// `createProject`/`duplicateProject` gate on the rate-limiter component, which
// this suite does not register — stub the helpers to no-ops while preserving
// the error type the caller branches on (same posture as
// webdav/tree_mutations.test.ts). The full export surface is provided so any
// transitively loaded convex module resolves its import.
vi.mock('../lib/rate_limiter/helpers', () => ({
  checkUserRateLimit: vi.fn(async () => undefined),
  checkOrganizationRateLimit: vi.fn(async () => undefined),
  checkIpRateLimit: vi.fn(async () => undefined),
  checkTeamRateLimit: vi.fn(async () => undefined),
  canPerformAction: vi.fn(async () => ({ allowed: true })),
  resetRateLimit: vi.fn(async () => undefined),
  RateLimitExceededError: class RateLimitExceededError extends Error {
    retryAfter = 0;
  },
}));

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/projects/), mirroring queries.test.ts.
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

const ORG_A = 'org_ext_a';
const ORG_B = 'org_ext_b';
const EDITOR = 'user_editor';
type T = TestConvex<typeof schema>;

function newWorld(): T {
  return convexTest(schema, modules);
}

async function seedEditor(t: T, organizationId: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${EDITOR}_${organizationId}`,
      userId: EDITOR,
      organizationId,
      role: 'editor',
      createdAt: 0,
    });
  });
}

function asEditor(t: T) {
  return t.withIdentity({ subject: EDITOR });
}

async function createProject(
  t: T,
  args: {
    organizationId?: string;
    name: string;
    externalItemId?: string;
  },
): Promise<Id<'projects'>> {
  return await asEditor(t).mutation(api.projects.mutations.createProject, {
    organizationId: args.organizationId ?? ORG_A,
    name: args.name,
    ...(args.externalItemId !== undefined
      ? { externalItemId: args.externalItemId }
      : {}),
  });
}

function codeOf(error: unknown): string | undefined {
  const raw = (error as { data?: unknown }).data;
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return typeof data === 'object' && data !== null && 'code' in data
    ? String(data.code)
    : undefined;
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  const error = await p.then(
    () => {
      throw new Error(`expected a rejection with code ${code}`);
    },
    (err: unknown) => err,
  );
  expect(codeOf(error)).toBe(code);
}

describe('createProject externalItemId', () => {
  it('stores the trimmed value and getProjectByExternalItemId finds it', async () => {
    const t = newWorld();
    await seedEditor(t, ORG_A);
    const projectId = await createProject(t, {
      name: 'Alpha',
      externalItemId: '  erp-42  ',
    });

    const row = await t.run(async (ctx) => await ctx.db.get(projectId));
    expect(row?.externalItemId).toBe('erp-42');

    const found = await t.query(
      internal.projects.internal_queries.getProjectByExternalItemId,
      { organizationId: ORG_A, externalItemId: 'erp-42' },
    );
    expect(found).toMatchObject({
      _id: projectId,
      name: 'Alpha',
      externalItemId: 'erp-42',
    });
    expect(found?.archivedAt).toBeUndefined();
  });

  it('refuses a duplicate external key in the same organization', async () => {
    const t = newWorld();
    await seedEditor(t, ORG_A);
    await createProject(t, { name: 'Alpha', externalItemId: 'erp-42' });

    await expectCode(
      createProject(t, { name: 'Beta', externalItemId: 'erp-42' }),
      'PROJECT_DUPLICATE_EXTERNAL_ID',
    );

    // The refused create must not have inserted a second row.
    const rows = await t.run(
      async (ctx) => await ctx.db.query('projects').collect(),
    );
    expect(rows).toHaveLength(1);
  });

  it('conflicts against an archived project too — uniqueness ignores lifecycle', async () => {
    const t = newWorld();
    await seedEditor(t, ORG_A);
    const projectId = await createProject(t, {
      name: 'Alpha',
      externalItemId: 'erp-42',
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { archivedAt: 123 });
    });

    await expectCode(
      createProject(t, { name: 'Beta', externalItemId: 'erp-42' }),
      'PROJECT_DUPLICATE_EXTERNAL_ID',
    );

    // The lookup still resolves the archived holder, and says it is archived.
    const found = await t.query(
      internal.projects.internal_queries.getProjectByExternalItemId,
      { organizationId: ORG_A, externalItemId: 'erp-42' },
    );
    expect(found).toMatchObject({ _id: projectId, archivedAt: 123 });
  });

  it('allows the same external key in two different organizations', async () => {
    const t = newWorld();
    await seedEditor(t, ORG_A);
    await seedEditor(t, ORG_B);
    const inA = await createProject(t, {
      organizationId: ORG_A,
      name: 'Alpha',
      externalItemId: 'erp-42',
    });
    const inB = await createProject(t, {
      organizationId: ORG_B,
      name: 'Alpha',
      externalItemId: 'erp-42',
    });

    const foundA = await t.query(
      internal.projects.internal_queries.getProjectByExternalItemId,
      { organizationId: ORG_A, externalItemId: 'erp-42' },
    );
    const foundB = await t.query(
      internal.projects.internal_queries.getProjectByExternalItemId,
      { organizationId: ORG_B, externalItemId: 'erp-42' },
    );
    expect(foundA?._id).toBe(inA);
    expect(foundB?._id).toBe(inB);
  });

  it('creates without the field exactly as before', async () => {
    const t = newWorld();
    await seedEditor(t, ORG_A);
    const projectId = await createProject(t, { name: 'Alpha' });

    const row = await t.run(async (ctx) => await ctx.db.get(projectId));
    expect(row?.name).toBe('Alpha');
    expect(row?.externalItemId).toBeUndefined();

    expect(
      await t.query(
        internal.projects.internal_queries.getProjectByExternalItemId,
        { organizationId: ORG_A, externalItemId: 'erp-42' },
      ),
    ).toBeNull();
  });

  it('refuses a blank external key', async () => {
    const t = newWorld();
    await seedEditor(t, ORG_A);
    await expectCode(
      createProject(t, { name: 'Alpha', externalItemId: '   ' }),
      'PROJECT_EXTERNAL_ITEM_ID_INVALID',
    );
  });

  it('caps the external key at 256 characters', async () => {
    const t = newWorld();
    await seedEditor(t, ORG_A);
    await expectCode(
      createProject(t, { name: 'Alpha', externalItemId: 'e'.repeat(257) }),
      'PROJECT_EXTERNAL_ITEM_ID_INVALID',
    );
    // Exactly at the cap is fine.
    const projectId = await createProject(t, {
      name: 'Beta',
      externalItemId: 'e'.repeat(256),
    });
    const row = await t.run(async (ctx) => await ctx.db.get(projectId));
    expect(row?.externalItemId).toBe('e'.repeat(256));
  });
});

describe('duplicateProject and externalItemId', () => {
  it('never clones the org-unique external key', async () => {
    const t = newWorld();
    await seedEditor(t, ORG_A);
    const sourceId = await createProject(t, {
      name: 'Alpha',
      externalItemId: 'erp-42',
    });

    const copyId = await asEditor(t).mutation(
      api.projects.mutations.duplicateProject,
      { projectId: sourceId },
    );

    const copy = await t.run(async (ctx) => await ctx.db.get(copyId));
    expect(copy?.name).toBe('Alpha (copy)');
    expect(copy?.externalItemId).toBeUndefined();

    // The source keeps sole claim on the key.
    const found = await t.query(
      internal.projects.internal_queries.getProjectByExternalItemId,
      { organizationId: ORG_A, externalItemId: 'erp-42' },
    );
    expect(found?._id).toBe(sourceId);
  });
});

describe('projectRowValidator carries externalItemId', () => {
  it('listProjects and getProject validate rows with and without the field', async () => {
    const t = newWorld();
    await seedEditor(t, ORG_A);
    const withKey = await createProject(t, {
      name: 'Alpha',
      externalItemId: 'erp-42',
    });
    const withoutKey = await createProject(t, { name: 'Beta' });

    const listed = await asEditor(t).query(api.projects.queries.listProjects, {
      organizationId: ORG_A,
    });
    const byName = Object.fromEntries(listed.map((p) => [p.name, p]));
    expect(listed).toHaveLength(2);
    expect(byName['Alpha']?.externalItemId).toBe('erp-42');
    expect(byName['Beta']?.externalItemId).toBeUndefined();

    const gotWith = await asEditor(t).query(api.projects.queries.getProject, {
      organizationId: ORG_A,
      projectId: withKey,
    });
    expect(gotWith?.externalItemId).toBe('erp-42');
    const gotWithout = await asEditor(t).query(
      api.projects.queries.getProject,
      { organizationId: ORG_A, projectId: withoutKey },
    );
    expect(gotWithout).not.toBeNull();
    expect(gotWithout?.externalItemId).toBeUndefined();
  });
});

describe('getProjectByIdForOrg', () => {
  it('returns the lookup projection only inside the owning org', async () => {
    const t = newWorld();
    await seedEditor(t, ORG_A);
    const projectId = await createProject(t, {
      name: 'Alpha',
      externalItemId: 'erp-42',
    });

    const found = await t.query(
      internal.projects.internal_queries.getProjectByIdForOrg,
      { organizationId: ORG_A, projectId: String(projectId) },
    );
    expect(found).toMatchObject({
      _id: projectId,
      name: 'Alpha',
      externalItemId: 'erp-42',
    });

    // Foreign org and garbage ids both read as absent, never as an error.
    expect(
      await t.query(internal.projects.internal_queries.getProjectByIdForOrg, {
        organizationId: ORG_B,
        projectId: String(projectId),
      }),
    ).toBeNull();
    expect(
      await t.query(internal.projects.internal_queries.getProjectByIdForOrg, {
        organizationId: ORG_A,
        projectId: 'not-an-id',
      }),
    ).toBeNull();
  });
});
