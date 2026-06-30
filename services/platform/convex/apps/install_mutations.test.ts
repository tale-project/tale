import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root. This file lives at
// convex/apps/, so resolve glob keys against that base.
const TEST_DIR_FROM_CONVEX_ROOT = 'apps';
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

const ORG = 'org_apps_bindings';
const APP = 'issue-desk';

type T = TestConvex<typeof schema>;

async function seedOrgInstall(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('appInstallations', {
      organizationId: ORG,
      appSlug: APP,
      installedAt: 0,
      installedBy: 'tester',
      status: 'active',
      requiredIntegrations: [],
      resources: [],
    });
  });
}

async function seedProject(
  t: T,
  name: string,
  organizationId = ORG,
): Promise<Id<'projects'>> {
  return await t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId,
      name,
      createdBy: 'tester',
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

async function countBindings(t: T): Promise<number> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db.query('appProjectBindings').collect();
    return rows.length;
  });
}

describe('app project bindings', () => {
  it('binds idempotently — one row per (org, app, project) (I6)', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    const projectId = await seedProject(t, 'Alpha');

    const first = await t.mutation(
      internal.apps.install_mutations.bindAppToProject,
      { organizationId: ORG, appSlug: APP, projectId, boundBy: 'tester' },
    );
    const second = await t.mutation(
      internal.apps.install_mutations.bindAppToProject,
      { organizationId: ORG, appSlug: APP, projectId, boundBy: 'tester' },
    );

    expect(second).toBe(first);
    expect(await countBindings(t)).toBe(1);
  });

  it('adds a SECOND project without dropping the first (multi-project)', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    const a = await seedProject(t, 'Alpha');
    const b = await seedProject(t, 'Beta');

    await t.mutation(internal.apps.install_mutations.bindAppToProject, {
      organizationId: ORG,
      appSlug: APP,
      projectId: a,
      boundBy: 'tester',
    });
    await t.mutation(internal.apps.install_mutations.bindAppToProject, {
      organizationId: ORG,
      appSlug: APP,
      projectId: b,
      boundBy: 'tester',
    });

    expect(await countBindings(t)).toBe(2);
  });

  it('refuses to bind when the org install row is absent (I7)', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'Alpha');
    await expect(
      t.mutation(internal.apps.install_mutations.bindAppToProject, {
        organizationId: ORG,
        appSlug: APP,
        projectId,
        boundBy: 'tester',
      }),
    ).rejects.toThrow(/not installed/i);
  });

  it('refuses to bind a project from a different org (I8)', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    const foreign = await seedProject(t, 'Foreign', 'org_other');
    await expect(
      t.mutation(internal.apps.install_mutations.bindAppToProject, {
        organizationId: ORG,
        appSlug: APP,
        projectId: foreign,
        boundBy: 'tester',
      }),
    ).rejects.toThrow(/not found in this organization/i);
  });

  it('refuses to bind while the app is mid-uninstall (I7 lock)', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    const projectId = await seedProject(t, 'Alpha');
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('appInstallations')
        .withIndex('by_org_slug', (q) =>
          q.eq('organizationId', ORG).eq('appSlug', APP),
        )
        .first();
      if (row) await ctx.db.patch(row._id, { uninstalling: true });
    });
    await expect(
      t.mutation(internal.apps.install_mutations.bindAppToProject, {
        organizationId: ORG,
        appSlug: APP,
        projectId,
        boundBy: 'tester',
      }),
    ).rejects.toThrow(/being uninstalled/i);
  });

  it('unbind deletes only its row and is idempotent (I3)', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    const a = await seedProject(t, 'Alpha');
    const b = await seedProject(t, 'Beta');
    for (const projectId of [a, b]) {
      await t.mutation(internal.apps.install_mutations.bindAppToProject, {
        organizationId: ORG,
        appSlug: APP,
        projectId,
        boundBy: 'tester',
      });
    }

    await t.mutation(internal.apps.install_mutations.unbindAppFromProject, {
      organizationId: ORG,
      appSlug: APP,
      projectId: a,
    });
    expect(await countBindings(t)).toBe(1);

    // Idempotent — unbinding again is a no-op.
    await t.mutation(internal.apps.install_mutations.unbindAppFromProject, {
      organizationId: ORG,
      appSlug: APP,
      projectId: a,
    });
    expect(await countBindings(t)).toBe(1);
  });
});

describe('beginUninstall guard (I1/I7)', () => {
  it('refuses with APP_HAS_BOUND_PROJECTS while a project is bound, naming it', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    const a = await seedProject(t, 'Alpha');
    await t.mutation(internal.apps.install_mutations.bindAppToProject, {
      organizationId: ORG,
      appSlug: APP,
      projectId: a,
      boundBy: 'tester',
    });

    let raw: unknown;
    try {
      await t.mutation(internal.apps.install_mutations.beginUninstall, {
        organizationId: ORG,
        appSlug: APP,
      });
    } catch (error) {
      raw = (error as { data?: unknown }).data;
    }
    // Real Convex delivers `.data` as the structured object; convex-test
    // serializes it to a JSON string — accept either.
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    expect(data).toMatchObject({
      code: 'APP_HAS_BOUND_PROJECTS',
      projects: ['Alpha'],
    });
  });

  it('takes the uninstalling lock at 0 bindings', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);

    const result = await t.mutation(
      internal.apps.install_mutations.beginUninstall,
      { organizationId: ORG, appSlug: APP },
    );
    expect(result).toEqual({ ok: true });

    const locked = await t.run(async (ctx) => {
      const row = await ctx.db
        .query('appInstallations')
        .withIndex('by_org_slug', (q) =>
          q.eq('organizationId', ORG).eq('appSlug', APP),
        )
        .first();
      return row?.uninstalling;
    });
    expect(locked).toBe(true);
  });

  it('reports notInstalled when no org row exists', async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(
      internal.apps.install_mutations.beginUninstall,
      { organizationId: ORG, appSlug: APP },
    );
    expect(result).toEqual({ ok: false, notInstalled: true });
  });

  it("deleteProjectSchedules removes only the target project's schedules", async () => {
    const t = convexTest(schema, modules);
    // Install carrying a workflow resource — the slug source for the sweep.
    await t.run(async (ctx) => {
      await ctx.db.insert('appInstallations', {
        organizationId: ORG,
        appSlug: APP,
        installedAt: 0,
        installedBy: 'tester',
        status: 'active',
        requiredIntegrations: [],
        resources: [
          {
            domain: 'workflows',
            path: 'issue-desk/reconcile.json',
            contentHash: 'h',
          },
        ],
      });
    });
    const a = await seedProject(t, 'Alpha');
    const b = await seedProject(t, 'Beta');
    const mkSched = (projectId: Id<'projects'>): Promise<Id<'wfSchedules'>> =>
      t.run((ctx) =>
        ctx.db.insert('wfSchedules', {
          organizationId: ORG,
          projectId,
          workflowSlug: 'issue-desk/reconcile',
          cronExpression: '*/15 * * * *',
          timezone: 'UTC',
          isActive: true,
          createdAt: 0,
          createdBy: 'system',
        }),
      );
    await mkSched(a);
    const schedB = await mkSched(b);

    await t.mutation(internal.apps.install_mutations.deleteProjectSchedules, {
      organizationId: ORG,
      appSlug: APP,
      projectId: a,
    });

    const remaining = await t.run((ctx) =>
      ctx.db.query('wfSchedules').collect(),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]._id).toBe(schedB);
    expect(remaining[0].projectId).toBe(b);
  });
});
