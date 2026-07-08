import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root. This file lives at
// convex/automations/, so resolve glob keys against that base.
const TEST_DIR_FROM_CONVEX_ROOT = 'automations';
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

const ORG = 'org_automation_bindings';
const AUTOMATION_SLUG = 'issue-desk';

type T = TestConvex<typeof schema>;

async function seedOrgInstall(t: T): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('automationInstallations', {
      organizationId: ORG,
      automationSlug: AUTOMATION_SLUG,
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
    const rows = await ctx.db.query('automationProjectBindings').collect();
    return rows.length;
  });
}

describe('automation project bindings', () => {
  it('binds idempotently — one row per (org, automation, project) (I6)', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    const projectId = await seedProject(t, 'Alpha');

    const first = await t.mutation(
      internal.automations.install_mutations.bindAutomationToProject,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        projectId,
        boundBy: 'tester',
      },
    );
    const second = await t.mutation(
      internal.automations.install_mutations.bindAutomationToProject,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        projectId,
        boundBy: 'tester',
      },
    );

    expect(second).toBe(first);
    expect(await countBindings(t)).toBe(1);
  });

  it('adds a SECOND project without dropping the first (multi-project)', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    const a = await seedProject(t, 'Alpha');
    const b = await seedProject(t, 'Beta');

    await t.mutation(
      internal.automations.install_mutations.bindAutomationToProject,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        projectId: a,
        boundBy: 'tester',
      },
    );
    await t.mutation(
      internal.automations.install_mutations.bindAutomationToProject,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        projectId: b,
        boundBy: 'tester',
      },
    );

    expect(await countBindings(t)).toBe(2);
  });

  it('refuses to bind when the org install row is absent (I7)', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'Alpha');
    await expect(
      t.mutation(
        internal.automations.install_mutations.bindAutomationToProject,
        {
          organizationId: ORG,
          automationSlug: AUTOMATION_SLUG,
          projectId,
          boundBy: 'tester',
        },
      ),
    ).rejects.toThrow(/not installed/i);
  });

  it('refuses to bind a project from a different org (I8)', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    const foreign = await seedProject(t, 'Foreign', 'org_other');
    await expect(
      t.mutation(
        internal.automations.install_mutations.bindAutomationToProject,
        {
          organizationId: ORG,
          automationSlug: AUTOMATION_SLUG,
          projectId: foreign,
          boundBy: 'tester',
        },
      ),
    ).rejects.toThrow(/not found in this organization/i);
  });

  it('refuses to bind while the automation is mid-uninstall (I7 lock)', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    const projectId = await seedProject(t, 'Alpha');
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('automationInstallations')
        .withIndex('by_org_slug', (q) =>
          q.eq('organizationId', ORG).eq('automationSlug', AUTOMATION_SLUG),
        )
        .first();
      if (row) await ctx.db.patch(row._id, { uninstalling: true });
    });
    await expect(
      t.mutation(
        internal.automations.install_mutations.bindAutomationToProject,
        {
          organizationId: ORG,
          automationSlug: AUTOMATION_SLUG,
          projectId,
          boundBy: 'tester',
        },
      ),
    ).rejects.toThrow(/being uninstalled/i);
  });

  it('unbind deletes only its row and is idempotent (I3)', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    const a = await seedProject(t, 'Alpha');
    const b = await seedProject(t, 'Beta');
    for (const projectId of [a, b]) {
      await t.mutation(
        internal.automations.install_mutations.bindAutomationToProject,
        {
          organizationId: ORG,
          automationSlug: AUTOMATION_SLUG,
          projectId,
          boundBy: 'tester',
        },
      );
    }

    await t.mutation(
      internal.automations.install_mutations.unbindAutomationFromProject,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        projectId: a,
      },
    );
    expect(await countBindings(t)).toBe(1);

    // Idempotent — unbinding again is a no-op.
    await t.mutation(
      internal.automations.install_mutations.unbindAutomationFromProject,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        projectId: a,
      },
    );
    expect(await countBindings(t)).toBe(1);
  });
});

describe('beginUninstall guard (I1/I7)', () => {
  it('refuses with AUTOMATION_HAS_BOUND_PROJECTS while a project is bound, naming it', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    const a = await seedProject(t, 'Alpha');
    await t.mutation(
      internal.automations.install_mutations.bindAutomationToProject,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        projectId: a,
        boundBy: 'tester',
      },
    );

    let raw: unknown;
    try {
      await t.mutation(internal.automations.install_mutations.beginUninstall, {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
      });
    } catch (error) {
      raw = (error as { data?: unknown }).data;
    }
    // Real Convex delivers `.data` as the structured object; convex-test
    // serializes it to a JSON string — accept either.
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    expect(data).toMatchObject({
      code: 'AUTOMATION_HAS_BOUND_PROJECTS',
      projects: ['Alpha'],
    });
  });

  it('takes the uninstalling lock at 0 bindings', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);

    const result = await t.mutation(
      internal.automations.install_mutations.beginUninstall,
      { organizationId: ORG, automationSlug: AUTOMATION_SLUG },
    );
    expect(result).toEqual({ ok: true });

    const locked = await t.run(async (ctx) => {
      const row = await ctx.db
        .query('automationInstallations')
        .withIndex('by_org_slug', (q) =>
          q.eq('organizationId', ORG).eq('automationSlug', AUTOMATION_SLUG),
        )
        .first();
      return row?.uninstalling;
    });
    expect(locked).toBe(true);
  });

  it('reports notInstalled when no org row exists', async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(
      internal.automations.install_mutations.beginUninstall,
      { organizationId: ORG, automationSlug: AUTOMATION_SLUG },
    );
    expect(result).toEqual({ ok: false, notInstalled: true });
  });

  it("deleteProjectSchedules removes only the target project's schedules", async () => {
    const t = convexTest(schema, modules);
    // The sweep's slug source is the `wfInstallations` ownership ledger (automationSlug
    // stamped at install), NOT the `resources` file ledger — which never lists
    // workflows (fan-out domains only). Seed it the realistic way.
    await t.run(async (ctx) => {
      await ctx.db.insert('automationInstallations', {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        installedAt: 0,
        installedBy: 'tester',
        status: 'active',
        requiredIntegrations: [],
        resources: [],
      });
      await ctx.db.insert('wfInstallations', {
        organizationId: ORG,
        workflowSlug: 'issue-desk/reconcile',
        automationSlug: AUTOMATION_SLUG,
        installedAt: 0,
        installedBy: 'tester',
        contentHash: 'h',
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

    await t.mutation(
      internal.automations.install_mutations.deleteProjectSchedules,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        projectId: a,
      },
    );

    const remaining = await t.run((ctx) =>
      ctx.db.query('wfSchedules').collect(),
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]._id).toBe(schedB);
    expect(remaining[0].projectId).toBe(b);
  });
});

describe('reconcileAutomationSchedules', () => {
  const SLUG = 'issue-desk/reconcile';
  const CRON = '*/15 * * * *';

  async function seedWfInstall(t: T): Promise<void> {
    await t.run((ctx) =>
      ctx.db.insert('wfInstallations', {
        organizationId: ORG,
        workflowSlug: SLUG,
        automationSlug: AUTOMATION_SLUG,
        installedAt: 0,
        installedBy: 'tester',
        contentHash: 'h',
      }),
    );
  }

  function mkSched(
    t: T,
    opts: {
      projectId?: Id<'projects'>;
      variables: Record<string, unknown>;
      isActive?: boolean;
      workflowSlug?: string;
    },
  ): Promise<Id<'wfSchedules'>> {
    return t.run((ctx) =>
      ctx.db.insert('wfSchedules', {
        organizationId: ORG,
        ...(opts.projectId ? { projectId: opts.projectId } : {}),
        workflowSlug: opts.workflowSlug ?? SLUG,
        cronExpression: CRON,
        timezone: 'UTC',
        isActive: opts.isActive ?? true,
        variables: opts.variables,
        createdAt: 0,
        createdBy: 'system',
      }),
    );
  }

  it('heals a drifted schedule and prunes org-level + unbound-project orphans', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    await seedWfInstall(t);
    const bound = await seedProject(t, 'Bound');
    const gone = await seedProject(t, 'Unbound');
    // B: the bound project's schedule, stale (repo configured after provisioning).
    const schedB = await mkSched(t, {
      projectId: bound,
      variables: { state: 'all' },
    });
    // A: org-level leftover from a pre-project-scope era. C: a since-unbound
    // project. Both must be pruned — they'd otherwise fire with no owner/repo.
    await mkSched(t, { variables: { state: 'all' } });
    await mkSched(t, { projectId: gone, variables: { state: 'all' } });

    const result = await t.mutation(
      internal.automations.install_mutations.reconcileAutomationSchedules,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        desired: [
          {
            workflowSlug: SLUG,
            cronExpression: CRON,
            timezone: 'UTC',
            projectId: bound,
            variables: { state: 'all', owner: 'acme', repo: 'widgets' },
          },
        ],
      },
    );
    expect(result).toEqual({ created: 0, updated: 1, pruned: 2 });

    const rows = await t.run((ctx) => ctx.db.query('wfSchedules').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toBe(schedB);
    expect(rows[0].variables).toEqual({
      state: 'all',
      owner: 'acme',
      repo: 'widgets',
    });
  });

  it('creates a desired schedule that does not yet exist', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    await seedWfInstall(t);
    const p = await seedProject(t, 'Fresh');

    const result = await t.mutation(
      internal.automations.install_mutations.reconcileAutomationSchedules,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        desired: [
          {
            workflowSlug: SLUG,
            cronExpression: CRON,
            timezone: 'UTC',
            projectId: p,
            variables: { state: 'all', owner: 'acme', repo: 'new' },
          },
        ],
      },
    );
    expect(result).toEqual({ created: 1, updated: 0, pruned: 0 });

    const rows = await t.run((ctx) => ctx.db.query('wfSchedules').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].projectId).toBe(p);
    expect(rows[0].isActive).toBe(true);
    expect(rows[0].variables).toEqual({
      state: 'all',
      owner: 'acme',
      repo: 'new',
    });
  });

  it('converges variables but leaves a disabled schedule disabled (opt-out sticks)', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    await seedWfInstall(t);
    const p = await seedProject(t, 'Paused');
    const sched = await mkSched(t, {
      projectId: p,
      variables: { state: 'all' },
      isActive: false,
    });

    await t.mutation(
      internal.automations.install_mutations.reconcileAutomationSchedules,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        desired: [
          {
            workflowSlug: SLUG,
            cronExpression: CRON,
            timezone: 'UTC',
            projectId: p,
            variables: { state: 'all', owner: 'acme', repo: 'paused' },
          },
        ],
      },
    );

    const row = await t.run((ctx) => ctx.db.get(sched));
    expect(row?.isActive).toBe(false);
    expect(row?.variables).toEqual({
      state: 'all',
      owner: 'acme',
      repo: 'paused',
    });
  });

  it('preserves operator-set variables + timezone when the file spec is empty (reinstall/rebind)', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    await seedWfInstall(t);
    const p = await seedProject(t, 'Configured');
    // Operator configured the repo + timezone via the workflow's Triggers tab.
    const sched = await t.run((ctx) =>
      ctx.db.insert('wfSchedules', {
        organizationId: ORG,
        projectId: p,
        workflowSlug: SLUG,
        cronExpression: CRON,
        timezone: 'America/New_York',
        isActive: true,
        variables: { owner: 'acme', repo: 'widgets', state: 'all' },
        createdAt: 0,
        createdBy: 'system',
      }),
    );

    // A plain reinstall/rebind reconciles against the FILE spec, which ships no
    // variables and no timezone — this must NOT wipe the operator's config.
    const result = await t.mutation(
      internal.automations.install_mutations.reconcileAutomationSchedules,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        desired: [
          {
            workflowSlug: SLUG,
            cronExpression: CRON,
            projectId: p,
            variables: {},
          },
        ],
      },
    );
    expect(result).toEqual({ created: 0, updated: 1, pruned: 0 });

    const row = await t.run((ctx) => ctx.db.get(sched));
    expect(row?.variables).toEqual({
      owner: 'acme',
      repo: 'widgets',
      state: 'all',
    });
    expect(row?.timezone).toBe('America/New_York');
  });

  it('never touches a schedule this automation does not own', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    await seedWfInstall(t);
    // A schedule for a workflow NOT owned by this automation (no matching wfInstallations
    // automationSlug) — a global/default-pack schedule that must survive reconcile.
    const foreign = await mkSched(t, {
      workflowSlug: 'projects/tasks/sweep-stale-work',
      variables: { keep: 'me' },
    });

    const result = await t.mutation(
      internal.automations.install_mutations.reconcileAutomationSchedules,
      { organizationId: ORG, automationSlug: AUTOMATION_SLUG, desired: [] },
    );
    expect(result).toEqual({ created: 0, updated: 0, pruned: 0 });

    const row = await t.run((ctx) => ctx.db.get(foreign));
    expect(row?.variables).toEqual({ keep: 'me' });
  });

  it('collapses accidental duplicate schedules to exactly one', async () => {
    const t = convexTest(schema, modules);
    await seedOrgInstall(t);
    await seedWfInstall(t);
    const p = await seedProject(t, 'Dup');
    // Two rows with the SAME identity (org, slug, cron, project) — an accidental
    // duplicate. Reconcile keeps one (converged) and prunes the other.
    await mkSched(t, { projectId: p, variables: { state: 'all' } });
    await mkSched(t, { projectId: p, variables: { state: 'all' } });

    const result = await t.mutation(
      internal.automations.install_mutations.reconcileAutomationSchedules,
      {
        organizationId: ORG,
        automationSlug: AUTOMATION_SLUG,
        desired: [
          {
            workflowSlug: SLUG,
            cronExpression: CRON,
            timezone: 'UTC',
            projectId: p,
            variables: { state: 'all', owner: 'acme', repo: 'dup' },
          },
        ],
      },
    );
    expect(result).toEqual({ created: 0, updated: 1, pruned: 1 });

    const rows = await t.run((ctx) => ctx.db.query('wfSchedules').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].variables).toEqual({
      state: 'all',
      owner: 'acme',
      repo: 'dup',
    });
  });
});
