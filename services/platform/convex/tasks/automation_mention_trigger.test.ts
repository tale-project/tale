// Coverage for the comment `@automation` work trigger — the app-lane twin of
// the agent mention trigger: a plain comment on an automation-owned task is
// just a comment; @-ing the OWNING automation schedules its task workflow
// (`startTaskWorkflowRun` → `automationRuns` row carrying the task subject).
// Locks the guard matrix (ownership cascade, write access, one engine per
// task) and the directory contract (store-name + display-name handles).

import agentComponent from '@convex-dev/agent/test';
import rateLimiterComponent from '@convex-dev/rate-limiter/test';
import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'tasks';
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

const ORG = 'org_automention';
const EDITOR = 'u_editor';
const VIEWER = 'u_viewer';
const DESK = 'vat-return-desk';
const OTHER = 'other-desk';

type T = TestConvex<typeof schema>;

const testBackends = new Set<T>();

// Drain the scheduled hand-offs a comment kicks (startTaskWorkflowRun, then
// the stepper's first step) so no background job leaks into the next test.
async function drain(t: T): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await t.finishInProgressScheduledFunctions();
  }
}

afterEach(async () => {
  await Promise.all([...testBackends].map((t) => drain(t)));
  testBackends.clear();
});

function world(): T {
  const t = convexTest(schema, modules);
  rateLimiterComponent.register(t);
  agentComponent.register(t);
  testBackends.add(t);
  return t;
}

/** A minimal runnable automation document — one transform node. */
function automationDocument(name: string) {
  return {
    version: 1,
    name,
    nodes: [{ id: 'shape', type: 'transform', code: 'return 1;' }],
    output: '{{ nodes.shape.output }}',
  };
}

async function seedWorld(
  t: T,
  taskOverrides: {
    assigneeType?: 'user' | 'agent' | 'app';
    assigneeId?: string;
    createdByType?: 'user' | 'agent' | 'app';
    createdBy?: string;
    externalSystem?: string;
  } = { assigneeType: 'app', assigneeId: DESK },
): Promise<{ projectId: Id<'projects'>; taskId: Id<'tasks'> }> {
  return t.run(async (ctx) => {
    for (const [userId, role] of [
      [EDITOR, 'editor'],
      [VIEWER, 'member'],
    ] as const) {
      await ctx.db.insert('memberMirror', {
        memberId: `m_${userId}_${ORG}`,
        userId,
        organizationId: ORG,
        role,
        createdAt: 0,
      });
    }
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Rhône-Alpes SARL',
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
    });
    for (const name of [DESK, OTHER]) {
      await ctx.db.insert('automations', {
        organizationId: ORG,
        name,
        version: 1,
        document: automationDocument(name),
        presentation: {
          name: name === DESK ? 'Swiss VAT return desk' : 'Other desk',
        },
        taskContract: {
          workflow: name,
          ...(name === DESK ? { externalSystem: 'vatplus' } : {}),
        },
        createdBy: EDITOR,
        createdAt: 0,
      });
      await ctx.db.insert('automationDeployments', {
        organizationId: ORG,
        name,
        version: 1,
        deployedBy: EDITOR,
        deployedAt: 0,
      });
    }
    const taskId = await ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'VAT return 2026Q1',
      status: 'in_review',
      rank: 'a0',
      createdBy: EDITOR,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
      ...taskOverrides,
    });
    return { projectId, taskId };
  });
}

async function runs(t: T) {
  return await t.run((ctx) => ctx.db.query('automationRuns').collect());
}

describe('comment @automation trigger', () => {
  it('@-ing the owning automation schedules its task workflow', async () => {
    const t = world();
    const { taskId } = await seedWorld(t);

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: `@${DESK} the summary still cites last period`,
      });
    expect(result.automationTriggered).toBe(true);
    await drain(t);

    const rows = await runs(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: DESK,
      mode: 'live',
      startedBy: `user:${EDITOR}`,
    });
    const input = rows[0]?.input as { task?: { id?: string } };
    expect(input.task?.id).toBe(String(taskId));
  });

  it('the display-name handle resolves and triggers too', async () => {
    const t = world();
    const { taskId } = await seedWorld(t);

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: '@swiss.vat.return.desk please redo the figures',
      });
    expect(result.automationTriggered).toBe(true);
    await drain(t);
    expect(await runs(t)).toHaveLength(1);
  });

  it('a plain comment never starts anything', async () => {
    const t = world();
    const { taskId } = await seedWorld(t);

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: 'looks wrong, but let me check the source files first',
      });
    expect(result.automationTriggered).toBe(false);
    await drain(t);
    expect(await runs(t)).toHaveLength(0);
  });

  it('@-ing an automation that does not own the task is a quiet no-op', async () => {
    const t = world();
    const { taskId } = await seedWorld(t);

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: `@${OTHER} take over`,
      });
    expect(result.automationTriggered).toBe(false);
    await drain(t);
    expect(await runs(t)).toHaveLength(0);
  });

  it("a read-only member's mention only comments", async () => {
    const t = world();
    const { taskId } = await seedWorld(t);

    const result = await t
      .withIdentity({ subject: VIEWER })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: `@${DESK} please rerun`,
      });
    expect(result.automationTriggered).toBe(false);
    await drain(t);
    expect(await runs(t)).toHaveLength(0);
  });

  it('changes nothing while a run is already operating the task', async () => {
    const t = world();
    const { projectId, taskId } = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('automationRuns', {
        organizationId: ORG,
        name: DESK,
        version: 1,
        projectId,
        status: 'running',
        mode: 'live',
        startedBy: `user:${EDITOR}`,
        input: { task: { id: String(taskId) } },
        checkpoints: { nodes: {}, executions: 0 },
        wakeAt: Date.now() + 60_000,
        claimEpoch: 0,
        startedAt: Date.now(),
      });
    });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: `@${DESK} hurry up`,
      });
    expect(result.automationTriggered).toBe(false);
    await drain(t);
    expect(await runs(t)).toHaveLength(1); // still only the live one
  });

  it('falls back to the creation stamp for unassigned tasks', async () => {
    const t = world();
    const { taskId } = await seedWorld(t, {
      createdByType: 'app',
      createdBy: DESK,
    });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: `@${DESK} numbers are stale`,
      });
    expect(result.automationTriggered).toBe(true);
    await drain(t);
    expect(await runs(t)).toHaveLength(1);
  });

  it("falls back to the automation's declared externalSystem namespace", async () => {
    const t = world();
    const { taskId } = await seedWorld(t, { externalSystem: 'vatplus' });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: `@${DESK} recalculate`,
      });
    expect(result.automationTriggered).toBe(true);
    await drain(t);
    expect(await runs(t)).toHaveLength(1);
  });

  it('an agent-assigned task ignores automation mentions', async () => {
    const t = world();
    const { taskId } = await seedWorld(t, {
      assigneeType: 'agent',
      assigneeId: 'some-agent',
    });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: `@${DESK} run anyway`,
      });
    expect(result.automationTriggered).toBe(false);
    await drain(t);
    expect(await runs(t)).toHaveLength(0);
  });

  it('the directory resolves an automation by store name and name variants', async () => {
    const t = world();
    const { projectId } = await seedWorld(t);

    const entry = await t.run(async (ctx) => {
      const project = await ctx.db.get(projectId);
      if (!project) throw new Error('project missing');
      const { buildMentionDirectory } = await import('./directory');
      const directory = await buildMentionDirectory(ctx, {
        organizationId: ORG,
        project,
      });
      return directory.entries.find(
        (e) => e.type === 'automation' && e.id === DESK,
      );
    });
    expect(entry).toBeDefined();
    expect(entry?.handles).toContain(DESK);
    expect(entry?.handles).toContain('swiss.vat.return.desk');
    expect(entry?.handles).toContain('swissvatreturndesk');
  });

  it('an automation bound to ANOTHER project is not mentionable here', async () => {
    const t = world();
    const { projectId, taskId } = await seedWorld(t);
    await t.run(async (ctx) => {
      const otherProject = await ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Elsewhere',
        createdBy: EDITOR,
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert('automationProjectBindings', {
        organizationId: ORG,
        automationName: DESK,
        projectId: otherProject,
        boundAt: 0,
        boundBy: EDITOR,
      });
    });

    const listed = await t.run(async (ctx) => {
      const project = await ctx.db.get(projectId);
      if (!project) throw new Error('project missing');
      const { buildMentionDirectory } = await import('./directory');
      const directory = await buildMentionDirectory(ctx, {
        organizationId: ORG,
        project,
      });
      return directory.entries.some(
        (e) => e.type === 'automation' && e.id === DESK,
      );
    });
    expect(listed).toBe(false);

    // …and the comment path stays inert for it (the token now resolves via
    // the permissive-agent fallback, which no-ops at agent run admission).
    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: `@${DESK} rerun`,
      });
    expect(result.automationTriggered).toBe(false);
    await drain(t);
    expect(await runs(t)).toHaveLength(0);
  });
});
