import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/tasks/), mirroring queries.test.ts.
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

const ORG = 'org_label_catalog';
const EDITOR = 'user_editor';
type T = TestConvex<typeof schema>;

async function seedMember(t: T, userId: string, role: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}`,
      userId,
      organizationId: ORG,
      role,
      createdAt: 0,
    });
  });
}

async function seedProject(t: T, name: string): Promise<Id<'projects'>> {
  return await t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name,
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

/** Project with an editor identity already able to write tasks + labels. */
async function seedWritableProject(t: T): Promise<Id<'projects'>> {
  const projectId = await seedProject(t, 'A');
  await seedMember(t, EDITOR, 'editor');
  return projectId;
}

/**
 * Insert a task row directly. The public `createTask` resolves labels through
 * the very same `resolveProjectLabels` call as `updateTask`, but it also takes
 * the rate limiter — an unregistered component under `convexTest` — so the
 * label assertions below drive attachment through `updateTask`.
 */
async function seedTask(
  t: T,
  projectId: Id<'projects'>,
  overrides: { number?: number; labels?: string[] } = {},
): Promise<Id<'tasks'>> {
  return await t.run((ctx) =>
    ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Task',
      status: 'todo',
      rank: 'a0',
      number: overrides.number ?? 1,
      createdBy: EDITOR,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
      ...(overrides.labels ? { labels: overrides.labels } : {}),
    }),
  );
}

function asEditor(t: T) {
  return t.withIdentity({ subject: EDITOR });
}

function attachLabels(t: T, taskId: Id<'tasks'>, labels: string[]) {
  return asEditor(t).mutation(api.tasks.mutations.updateTask, {
    taskId,
    labels,
  });
}

/** Catalog names for a project, alphabetically (the query's own order). */
async function catalogNames(
  t: T,
  projectId: Id<'projects'>,
): Promise<string[]> {
  const rows = await asEditor(t).query(api.tasks.queries.listTaskLabels, {
    projectId,
    organizationId: ORG,
  });
  return rows.map((r) => r.name);
}

async function labelNamesOnTask(t: T, taskId: Id<'tasks'>): Promise<string[]> {
  const result = await asEditor(t).query(api.tasks.queries.getTask, {
    taskId,
    organizationId: ORG,
  });
  if (!result) throw new Error('task not readable');
  return (result.task.labels ?? []).map((l) => l.name);
}

describe('ensureDefaultTaskLabels', () => {
  it('seeds the built-in trio and is idempotent across calls', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedWritableProject(t);

    await asEditor(t).mutation(api.tasks.mutations.ensureDefaultTaskLabels, {
      projectId,
    });
    expect(await catalogNames(t, projectId)).toEqual([
      'bug',
      'feature',
      'improvement',
    ]);

    // A second call must not mint duplicate rows.
    await asEditor(t).mutation(api.tasks.mutations.ensureDefaultTaskLabels, {
      projectId,
    });
    expect(await catalogNames(t, projectId)).toEqual([
      'bug',
      'feature',
      'improvement',
    ]);
  });
});

describe('createTaskLabel', () => {
  it('normalizes the name and rejects a duplicate', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedWritableProject(t);

    await asEditor(t).mutation(api.tasks.mutations.createTaskLabel, {
      projectId,
      name: '  Urgent  ',
    });
    expect(await catalogNames(t, projectId)).toEqual(['urgent']);

    // Same name in a different case is the same label.
    await expect(
      asEditor(t).mutation(api.tasks.mutations.createTaskLabel, {
        projectId,
        name: 'URGENT',
      }),
    ).rejects.toThrow(/TASK_LABEL_NAME_TAKEN/);
  });

  it('scopes the catalog per project', async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedWritableProject(t);
    const projectB = await seedProject(t, 'B');

    await asEditor(t).mutation(api.tasks.mutations.createTaskLabel, {
      projectId: projectA,
      name: 'urgent',
    });

    expect(await catalogNames(t, projectA)).toEqual(['urgent']);
    expect(await catalogNames(t, projectB)).toEqual([]);
  });
});

describe('updateTaskLabel', () => {
  it('renames in place — attached tasks follow the id, not the string', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedWritableProject(t);

    const labelId = await asEditor(t).mutation(
      api.tasks.mutations.createTaskLabel,
      { projectId, name: 'urgent' },
    );
    const taskId = await seedTask(t, projectId);
    await attachLabels(t, taskId, ['urgent']);
    expect(await labelNamesOnTask(t, taskId)).toEqual(['urgent']);

    await asEditor(t).mutation(api.tasks.mutations.updateTaskLabel, {
      labelId,
      name: 'critical',
    });
    // No task rewrite happened, yet the task reads the new name.
    expect(await labelNamesOnTask(t, taskId)).toEqual(['critical']);
  });

  it('rejects a rename onto an existing name', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedWritableProject(t);

    const labelId = await asEditor(t).mutation(
      api.tasks.mutations.createTaskLabel,
      { projectId, name: 'urgent' },
    );
    await asEditor(t).mutation(api.tasks.mutations.createTaskLabel, {
      projectId,
      name: 'blocked',
    });

    await expect(
      asEditor(t).mutation(api.tasks.mutations.updateTaskLabel, {
        labelId,
        name: 'blocked',
      }),
    ).rejects.toThrow(/TASK_LABEL_NAME_TAKEN/);
  });
});

describe('deleteTaskLabel', () => {
  it('refuses while a task still holds the label, unless detach is set', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedWritableProject(t);

    const labelId = await asEditor(t).mutation(
      api.tasks.mutations.createTaskLabel,
      { projectId, name: 'urgent' },
    );
    const taskId = await seedTask(t, projectId);
    await attachLabels(t, taskId, ['urgent']);

    await expect(
      asEditor(t).mutation(api.tasks.mutations.deleteTaskLabel, { labelId }),
    ).rejects.toThrow(/TASK_LABEL_IN_USE/);
    expect(await labelNamesOnTask(t, taskId)).toEqual(['urgent']);

    await asEditor(t).mutation(api.tasks.mutations.deleteTaskLabel, {
      labelId,
      detach: true,
    });
    expect(await catalogNames(t, projectId)).toEqual([]);
    expect(await labelNamesOnTask(t, taskId)).toEqual([]);
  });
});

describe('attaching labels to a task', () => {
  it('rejects a name the project catalog does not hold', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedWritableProject(t);
    const taskId = await seedTask(t, projectId);

    await expect(attachLabels(t, taskId, ['nope'])).rejects.toThrow(
      /TASK_LABEL_UNKNOWN/,
    );
    expect(await catalogNames(t, projectId)).toEqual([]);
  });

  it('reuses the catalog row instead of minting a second one', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedWritableProject(t);

    await asEditor(t).mutation(api.tasks.mutations.createTaskLabel, {
      projectId,
      name: 'urgent',
    });
    for (const number of [1, 2]) {
      const taskId = await seedTask(t, projectId, { number });
      await attachLabels(t, taskId, ['urgent']);
    }
    expect(await catalogNames(t, projectId)).toEqual(['urgent']);
  });

  it('clears labels on an explicit empty array', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedWritableProject(t);

    await asEditor(t).mutation(api.tasks.mutations.createTaskLabel, {
      projectId,
      name: 'urgent',
    });
    const taskId = await seedTask(t, projectId);
    await attachLabels(t, taskId, ['urgent']);

    await attachLabels(t, taskId, []);
    expect(await labelNamesOnTask(t, taskId)).toEqual([]);
    // Clearing a task must not remove the label from the project catalog.
    expect(await catalogNames(t, projectId)).toEqual(['urgent']);
  });
});

describe('agent label writes', () => {
  it('creates catalog rows on the fly for external sync', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedWritableProject(t);

    await t.mutation(
      internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
      {
        organizationId: ORG,
        actorId: EDITOR,
        projectId,
        externalSystem: 'github',
        externalId: 'owner/repo#1',
        title: 'Issue 1',
        externalState: 'open',
        labels: ['good first issue', 'bug'],
      },
    );

    // Unknown names are minted (not rejected) on the agent path.
    expect(await catalogNames(t, projectId)).toEqual([
      'bug',
      'good first issue',
    ]);
  });
});

describe('read paths mid-migration', () => {
  it('still resolves a task carrying pre-catalog string labels', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedWritableProject(t);

    // A row as it looks BEFORE the task-labels migration runs: freeform
    // strings, no labelIds. The read path must still render it.
    const taskId = await seedTask(t, projectId, { labels: ['bug'] });

    expect(await labelNamesOnTask(t, taskId)).toEqual(['bug']);
  });
});
