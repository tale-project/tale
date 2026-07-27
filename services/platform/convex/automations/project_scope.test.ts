/**
 * Project-bound automations. Pins the binding contract: the first save binds
 * the install target (a row in `automationProjectBindings`), later saves
 * never touch bindings, `reconcileAutomationProjects` edits the whole set in
 * one transaction, the three listing modes split on the binding set, runs are
 * attributed to the caller's project context (sole-binding fallback), and a
 * project cannot be deleted while an automation is bound to it.
 *
 * Writes drive the STORE seam directly (`automationStore` / `beginRun` inside
 * `t.run`): the public mutations resolve the org through the Better Auth
 * component, which convexTest cannot register — their arg plumbing is typed,
 * and the contract under test lives in the store. Reads go through the public
 * queries (their membership gate resolves via the seeded memberMirror).
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { assertNoBoundAutomations } from '../projects/mutations';
import schema from '../schema';
import { beginRun } from './mutations';
import {
  automationStore,
  bindingsOf,
  reconcileAutomationProjects,
} from './store';

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

const ORG = 'org_project_scope';
const MEMBER = 'user_member';
type T = TestConvex<typeof schema>;

async function seed(t: T): Promise<Id<'projects'>> {
  return t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: 'ba_member_1',
      userId: MEMBER,
      organizationId: ORG,
      role: 'member',
      createdAt: 0,
    });
    return ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'VAT desk',
      createdBy: MEMBER,
      createdAt: 0,
      updatedAt: 0,
    });
  });
}

async function addProject(t: T, name: string): Promise<Id<'projects'>> {
  return t.run(async (ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name,
      createdBy: MEMBER,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

const AUTOMATION = (name: string) => ({
  version: 1 as const,
  name,
  nodes: [],
});

async function saveAs(
  t: T,
  name: string,
  projectId?: Id<'projects'>,
): Promise<void> {
  await t.run(async (ctx) => {
    const store = automationStore(ctx, {
      organizationId: ORG,
      actor: MEMBER,
      ...(projectId !== undefined && { projectId }),
    });
    await store.save(AUTOMATION(name));
  });
}

async function bindingProjects(t: T, name: string): Promise<string[]> {
  return t.run(async (ctx) =>
    (await bindingsOf(ctx, ORG, name)).map((row) => String(row.projectId)),
  );
}

describe('project-bound automations', () => {
  it('first save binds the install target and splits the listings', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seed(t);
    const asMember = t.withIdentity({ subject: MEMBER });

    await saveAs(t, 'org/digest');
    await saveAs(t, 'desk/prepare-return', projectId);

    expect(await bindingProjects(t, 'desk/prepare-return')).toEqual([
      String(projectId),
    ]);

    const orgList = await asMember.query(
      api.automations.queries.listAutomations,
      { organizationId: ORG },
    );
    expect(orgList.map((a) => a.name)).toEqual(['org/digest']);

    const projectList = await asMember.query(
      api.automations.queries.listAutomations,
      { organizationId: ORG, projectId },
    );
    expect(projectList.map((a) => a.name)).toEqual(['desk/prepare-return']);

    // The merged admin view carries the binding set per row.
    const adminList = await asMember.query(
      api.automations.queries.listAutomations,
      { organizationId: ORG, includeProjectBound: true },
    );
    expect(adminList.map((a) => [a.name, a.projectIds])).toEqual([
      ['desk/prepare-return', [projectId]],
      ['org/digest', []],
    ]);
  });

  it('surfaces the DEPLOYED version contract and settings on the listing', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seed(t);
    const asMember = t.withIdentity({ subject: MEMBER });

    const taskContract = { workflow: 'desk/prepare-return' };
    const settings = {
      forms: [
        {
          file: 'fx-policy.yaml',
          title: 'FX conversion policy',
          fields: [{ key: 'method', label: 'Method', type: 'text' }],
        },
      ],
    };
    await t.run(async (ctx) => {
      const store = automationStore(ctx, {
        organizationId: ORG,
        actor: MEMBER,
        projectId,
      });
      await store.save(AUTOMATION('desk/prepare-return'), undefined, {
        taskContract,
        settings,
      });
    });

    // Draft only — the listing carries neither payload yet.
    const drafts = await asMember.query(
      api.automations.queries.listAutomations,
      { organizationId: ORG, projectId },
    );
    expect(drafts[0]).not.toHaveProperty('settings');
    expect(drafts[0]).not.toHaveProperty('taskContract');

    await t.run(async (ctx) => {
      const store = automationStore(ctx, {
        organizationId: ORG,
        actor: MEMBER,
        projectId,
      });
      await store.deploy('desk/prepare-return', 1);
    });

    const deployed = await asMember.query(
      api.automations.queries.listAutomations,
      { organizationId: ORG, projectId },
    );
    expect(deployed[0]).toMatchObject({
      name: 'desk/prepare-return',
      deployedVersion: 1,
      taskContract,
      settings,
    });
  });

  it('binds through the action-side storeSave too', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seed(t);
    const asMember = t.withIdentity({ subject: MEMBER });

    // The adapter an action holds (builder session, MCP dispatch) forwards
    // its project scope through this internal mutation; dropping it would
    // silently install a project automation org-wide.
    await t.mutation(internal.automations.mutations.storeSave, {
      organizationId: ORG,
      actor: MEMBER,
      automation: AUTOMATION('desk/prepare-return'),
      projectId,
    });

    expect(await bindingProjects(t, 'desk/prepare-return')).toEqual([
      String(projectId),
    ]);
    const orgList = await asMember.query(
      api.automations.queries.listAutomations,
      { organizationId: ORG },
    );
    expect(orgList).toEqual([]);
  });

  it('later saves never touch bindings — a different scope is ignored', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seed(t);
    const otherProjectId = await addProject(t, 'Other');

    await saveAs(t, 'desk/prepare-return', projectId);
    // A projectless second save keeps the binding; a save carrying ANOTHER
    // project neither moves nor extends it — membership is managed
    // explicitly, never as a side effect of saving a version.
    await saveAs(t, 'desk/prepare-return');
    await saveAs(t, 'desk/prepare-return', otherProjectId);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('automations')
        .withIndex('by_org_name', (q) =>
          q.eq('organizationId', ORG).eq('name', 'desk/prepare-return'),
        )
        .collect(),
    );
    expect(rows).toHaveLength(3);
    // The deprecated scalar pin is never written again.
    expect(rows.every((row) => row.projectId === undefined)).toBe(true);
    expect(await bindingProjects(t, 'desk/prepare-return')).toEqual([
      String(projectId),
    ]);
  });

  it('reconciles the binding set in one call and refuses a foreign project', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seed(t);
    const otherProjectId = await addProject(t, 'Other');
    const asMember = t.withIdentity({ subject: MEMBER });

    await saveAs(t, 'desk/prepare-return', projectId);
    await t.run(async (ctx) => {
      await reconcileAutomationProjects(ctx, {
        organizationId: ORG,
        actor: MEMBER,
        name: 'desk/prepare-return',
        projectIds: [projectId, otherProjectId],
      });
    });
    expect((await bindingProjects(t, 'desk/prepare-return')).sort()).toEqual(
      [String(projectId), String(otherProjectId)].sort(),
    );

    // Bound to BOTH projects: each project's listing carries it.
    for (const surface of [projectId, otherProjectId]) {
      const list = await asMember.query(
        api.automations.queries.listAutomations,
        { organizationId: ORG, projectId: surface },
      );
      expect(list.map((a) => a.name)).toEqual(['desk/prepare-return']);
    }

    // Back to org-level: the empty set unbinds everything.
    await t.run(async (ctx) => {
      const result = await reconcileAutomationProjects(ctx, {
        organizationId: ORG,
        actor: MEMBER,
        name: 'desk/prepare-return',
        projectIds: [],
      });
      expect(result).toEqual({ bound: 0, unbound: 2 });
    });
    expect(await bindingProjects(t, 'desk/prepare-return')).toEqual([]);

    // A project of another organization refuses — a binding row is only
    // ever a true statement.
    const foreignProject = await t.run(async (ctx) =>
      ctx.db.insert('projects', {
        organizationId: 'org_other',
        name: 'Foreign',
        createdBy: MEMBER,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    await expect(
      t.run(async (ctx) =>
        reconcileAutomationProjects(ctx, {
          organizationId: ORG,
          actor: MEMBER,
          name: 'desk/prepare-return',
          projectIds: [foreignProject],
        }),
      ),
    ).rejects.toThrow(/does not exist in this organization/);

    // An unknown automation refuses too.
    await expect(
      t.run(async (ctx) =>
        reconcileAutomationProjects(ctx, {
          organizationId: ORG,
          actor: MEMBER,
          name: 'no/such-automation',
          projectIds: [projectId],
        }),
      ),
    ).rejects.toThrow(/has no versions/);
  });

  it('attributes runs to the caller project, then the sole binding, then nobody', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seed(t);
    const otherProjectId = await addProject(t, 'Other');
    const asMember = t.withIdentity({ subject: MEMBER });

    await saveAs(t, 'desk/prepare-return', projectId);
    await t.run(async (ctx) => {
      const store = automationStore(ctx, {
        organizationId: ORG,
        actor: MEMBER,
      });
      await store.deploy('desk/prepare-return', 1);
    });

    // No caller context → the sole binding attributes the run.
    const soleRun = await t.run(async (ctx) =>
      beginRun(ctx, {
        organizationId: ORG,
        name: 'desk/prepare-return',
        input: {},
        mode: 'mock',
        startedBy: `user:${MEMBER}`,
      }),
    );
    if (soleRun === null) throw new Error('beginRun returned null');
    const soleRow = await t.run(async (ctx) => ctx.db.get(soleRun.runId));
    expect(soleRow?.projectId).toBe(projectId);

    const projectRuns = await asMember.query(api.automations.queries.listRuns, {
      organizationId: ORG,
      projectId,
    });
    expect(projectRuns.map((row) => row.id)).toContain(soleRun.runId);

    // An explicit caller context wins over the binding.
    const callerRun = await t.run(async (ctx) =>
      beginRun(ctx, {
        organizationId: ORG,
        name: 'desk/prepare-return',
        input: {},
        mode: 'mock',
        startedBy: `user:${MEMBER}`,
        projectId: otherProjectId,
      }),
    );
    if (callerRun === null) throw new Error('beginRun returned null');
    const callerRow = await t.run(async (ctx) => ctx.db.get(callerRun.runId));
    expect(callerRow?.projectId).toBe(otherProjectId);

    // Multi-bound with no caller context → attributed to no project.
    await t.run(async (ctx) => {
      await reconcileAutomationProjects(ctx, {
        organizationId: ORG,
        actor: MEMBER,
        name: 'desk/prepare-return',
        projectIds: [projectId, otherProjectId],
      });
    });
    const ambiguousRun = await t.run(async (ctx) =>
      beginRun(ctx, {
        organizationId: ORG,
        name: 'desk/prepare-return',
        input: {},
        mode: 'mock',
        startedBy: `user:${MEMBER}`,
      }),
    );
    if (ambiguousRun === null) throw new Error('beginRun returned null');
    const ambiguousRow = await t.run(async (ctx) =>
      ctx.db.get(ambiguousRun.runId),
    );
    expect(ambiguousRow?.projectId).toBeUndefined();
  });

  it('finds an ORG-LEVEL automation run operating a task by the task project', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seed(t);
    const asMember = t.withIdentity({ subject: MEMBER });

    await saveAs(t, 'org/task-worker');
    const taskId = await t.run(async (ctx) =>
      ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId,
        title: 'Prepare the return',
        status: 'in_progress',
        rank: 'a0',
        createdBy: MEMBER,
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    await t.run(async (ctx) => {
      const store = automationStore(ctx, {
        organizationId: ORG,
        actor: MEMBER,
      });
      await store.deploy('org/task-worker', 1);
      // The task path stamps the TASK's project (startTaskWorkflowRun's
      // contract), which is exactly what makes the org-level automation's
      // run visible to the task modal.
      await beginRun(ctx, {
        organizationId: ORG,
        name: 'org/task-worker',
        input: { task: { id: String(taskId) } },
        mode: 'live',
        startedBy: `user:${MEMBER}`,
        projectId,
      });
    });

    const live = await asMember.query(
      api.automations.queries.getLiveRunForTask,
      { organizationId: ORG, projectId, taskId },
    );
    expect(live?.name).toBe('org/task-worker');
  });

  it('refuses deleting a project while an automation is bound to it', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seed(t);

    await saveAs(t, 'desk/prepare-return', projectId);
    await expect(
      t.run(async (ctx) => assertNoBoundAutomations(ctx, projectId)),
    ).rejects.toThrow(/PROJECT_HAS_BOUND_AUTOMATIONS|bound/i);

    await t.run(async (ctx) => {
      await reconcileAutomationProjects(ctx, {
        organizationId: ORG,
        actor: MEMBER,
        name: 'desk/prepare-return',
        projectIds: [],
      });
    });
    // Unbound: the guard passes (resolving without throwing is the pass).
    await t.run(async (ctx) => assertNoBoundAutomations(ctx, projectId));
  });
});
