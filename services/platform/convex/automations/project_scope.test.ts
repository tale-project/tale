/**
 * Project-scoped automations. Pins the ownership contract: the first version
 * pins an automation to its surface (org page or one project's tab), later
 * saves inherit it, a cross-project save refuses, runs denormalize the owner,
 * and the two listings never bleed into each other.
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
import schema from '../schema';
import { beginRun } from './mutations';
import { automationStore } from './store';

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

const WORKFLOW = (name: string) => ({
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
    await store.save(WORKFLOW(name));
  });
}

describe('project-scoped automations', () => {
  it('pins ownership on first save and splits the two listings', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seed(t);
    const asMember = t.withIdentity({ subject: MEMBER });

    await saveAs(t, 'org/digest');
    await saveAs(t, 'desk/prepare-return', projectId);

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
  });

  it('pins ownership through the action-side storeSave too', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seed(t);
    const asMember = t.withIdentity({ subject: MEMBER });

    // The adapter an action holds (builder session, MCP dispatch) forwards
    // its project scope through this internal mutation; dropping it would
    // silently re-home a project automation onto the org page.
    await t.mutation(internal.automations.mutations.storeSave, {
      organizationId: ORG,
      actor: MEMBER,
      workflow: WORKFLOW('desk/prepare-return'),
      projectId,
    });

    const orgList = await asMember.query(
      api.automations.queries.listAutomations,
      { organizationId: ORG },
    );
    expect(orgList).toEqual([]);
    const projectList = await asMember.query(
      api.automations.queries.listAutomations,
      { organizationId: ORG, projectId },
    );
    expect(projectList.map((a) => a.name)).toEqual(['desk/prepare-return']);
  });

  it('keeps ownership on later saves and refuses a cross-project move', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seed(t);
    const otherProjectId = await t.run(async (ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Other',
        createdBy: MEMBER,
        createdAt: 0,
        updatedAt: 0,
      }),
    );

    await saveAs(t, 'desk/prepare-return', projectId);
    // A projectless second save inherits the owner.
    await saveAs(t, 'desk/prepare-return');
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query('workflows')
        .withIndex('by_org_name', (q) =>
          q.eq('organizationId', ORG).eq('name', 'desk/prepare-return'),
        )
        .collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.projectId === projectId)).toBe(true);

    await expect(
      saveAs(t, 'desk/prepare-return', otherProjectId),
    ).rejects.toThrow(/different surface/);
  });

  it('denormalizes the owner onto runs and filters the project run log', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seed(t);
    const asMember = t.withIdentity({ subject: MEMBER });

    await saveAs(t, 'desk/prepare-return', projectId);
    const started = await t.run(async (ctx) => {
      const store = automationStore(ctx, {
        organizationId: ORG,
        actor: MEMBER,
      });
      await store.deploy('desk/prepare-return', 1);
      return beginRun(ctx, {
        organizationId: ORG,
        name: 'desk/prepare-return',
        input: {},
        mode: 'mock',
        startedBy: `user:${MEMBER}`,
      });
    });
    expect(started).not.toBeNull();
    if (started === null) throw new Error('beginRun returned null');

    const run = await t.run(async (ctx) => ctx.db.get(started.runId));
    expect(run?.projectId).toBe(projectId);

    const projectRuns = await asMember.query(api.automations.queries.listRuns, {
      organizationId: ORG,
      projectId,
    });
    expect(projectRuns.map((row) => row.id)).toContain(started.runId);

    const emptyProjectId = await t.run(async (ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Empty',
        createdBy: MEMBER,
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const otherProjectRuns = await asMember.query(
      api.automations.queries.listRuns,
      {
        organizationId: ORG,
        name: 'desk/prepare-return',
        projectId: emptyProjectId,
      },
    );
    expect(otherProjectRuns).toEqual([]);
  });
});
