/**
 * Mark-and-return sweeps for start-reached / due-soon date notifications.
 */
import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
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

const ORG = 'org_date_sweeps';
const CREATOR = 'user_creator';
const PROJECT_CREATOR = 'user_project_creator';
type T = TestConvex<typeof schema>;

async function seedProject(t: T): Promise<Id<'projects'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Dates',
      createdBy: PROJECT_CREATOR,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

async function seedTask(
  t: T,
  projectId: Id<'projects'>,
  fields: {
    title: string;
    startDate?: number;
    dueDate?: number;
    startNotifiedAt?: number;
    slaLevel?: number;
    assigneeType?: 'user' | 'agent' | 'app';
    assigneeId?: string;
    status?: 'backlog' | 'todo' | 'in_progress' | 'done';
  },
): Promise<Id<'tasks'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: fields.title,
      status: fields.status ?? 'todo',
      rank: 'a0',
      createdBy: CREATOR,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
      statusChangedAt: 0,
      ...(fields.startDate !== undefined
        ? { startDate: fields.startDate }
        : {}),
      ...(fields.dueDate !== undefined ? { dueDate: fields.dueDate } : {}),
      ...(fields.startNotifiedAt !== undefined
        ? { startNotifiedAt: fields.startNotifiedAt }
        : {}),
      ...(fields.slaLevel !== undefined ? { slaLevel: fields.slaLevel } : {}),
      ...(fields.assigneeType !== undefined
        ? { assigneeType: fields.assigneeType, assigneeId: fields.assigneeId }
        : {}),
    }),
  );
}

describe('sweepStartingTasks', () => {
  it('returns an open task whose start date has arrived and stamps once', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t);
    const now = Date.now();
    const taskId = await seedTask(t, projectId, {
      title: 'Start me',
      startDate: now - 60_000,
    });

    const first = await t.mutation(
      internal.tasks.internal_mutations.sweepStartingTasks,
      { organizationId: ORG, limit: 50 },
    );
    expect(first).toHaveLength(1);
    expect(first[0]?.taskId).toBe(taskId);
    expect(first[0]?.taskCreatorId).toBe(CREATOR);
    expect(first[0]?.projectCreatorId).toBe(PROJECT_CREATOR);

    const stamped = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(stamped?.startNotifiedAt).toBeTypeOf('number');

    const second = await t.mutation(
      internal.tasks.internal_mutations.sweepStartingTasks,
      { organizationId: ORG, limit: 50 },
    );
    expect(second).toHaveLength(0);
  });

  it('skips terminal and future-start tasks', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t);
    const now = Date.now();
    await seedTask(t, projectId, {
      title: 'Done',
      startDate: now - 60_000,
      status: 'done',
    });
    await seedTask(t, projectId, {
      title: 'Future',
      startDate: now + 86_400_000,
    });

    const rows = await t.mutation(
      internal.tasks.internal_mutations.sweepStartingTasks,
      { organizationId: ORG, limit: 50 },
    );
    expect(rows).toHaveLength(0);
  });
});

describe('sweepDueSoonTasks', () => {
  it('includes the human task creator on the row', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t);
    const now = Date.now();
    const taskId = await seedTask(t, projectId, {
      title: 'Due soon',
      dueDate: now + 2 * 60 * 60 * 1000,
    });

    const rows = await t.mutation(
      internal.tasks.internal_mutations.sweepDueSoonTasks,
      { organizationId: ORG, windowHours: 24, limit: 50 },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.taskId).toBe(taskId);
    expect(rows[0]?.taskCreatorId).toBe(CREATOR);
    expect(rows[0]?.projectCreatorId).toBe(PROJECT_CREATOR);
  });
});

describe('updateTask clears startNotifiedAt', () => {
  it('resets the start stamp when the start date moves', async () => {
    const t = convexTest(schema, modules);
    const projectId = await t.run(async (ctx) => {
      await ctx.db.insert('memberMirror', {
        memberId: `m_${CREATOR}_${ORG}`,
        userId: CREATOR,
        organizationId: ORG,
        role: 'editor',
        createdAt: 0,
      });
      return ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Dates',
        createdBy: PROJECT_CREATOR,
        createdAt: 0,
        updatedAt: 0,
      });
    });
    const now = Date.now();
    const taskId = await seedTask(t, projectId, {
      title: 'Reschedule',
      startDate: now - 60_000,
      startNotifiedAt: now - 30_000,
    });

    const as = t.withIdentity({ subject: CREATOR });
    await as.mutation(api.tasks.mutations.updateTask, {
      taskId,
      startDate: now + 86_400_000,
    });

    const after = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(after?.startNotifiedAt).toBeUndefined();
    expect(after?.startDate).toBe(now + 86_400_000);
  });
});
