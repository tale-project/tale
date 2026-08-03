// `agentRecordTaskOutputs` — the Output zone's write side. The settle merges
// each run's harvested deliverables by fileName: same name REPLACES the entry
// and purges the superseded blob's metadata, new names append, and the task
// row always shows the latest deliverable set.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
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

const ORG = 'org_outputs';

type T = TestConvex<typeof schema>;

async function seedWorld(t: T): Promise<{
  taskId: Id<'tasks'>;
  runId: Id<'projectAgentRuns'>;
}> {
  return t.run(async (ctx) => {
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Apollo',
      createdBy: 'u_editor',
      createdAt: 0,
      updatedAt: 0,
    });
    const agentId = await ctx.db.insert('projectAgents', {
      organizationId: ORG,
      projectId,
      name: 'Alice',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      skills: [],
      connectors: [],
      createdBy: 'u_editor',
      createdAt: 0,
      updatedAt: 0,
    });
    const taskId = await ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Build the deck',
      status: 'in_progress',
      rank: 'a0',
      assigneeType: 'agent',
      assigneeId: agentId,
      createdBy: 'u_editor',
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    });
    const runId = await ctx.db.insert('projectAgentRuns', {
      organizationId: ORG,
      projectId,
      taskId,
      agentId,
      execId: 'exec-1',
      sessionId: 'pa-alice',
      status: 'running',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      startedBy: 'u_editor',
      startedAt: 0,
      deadlineAt: 10_000,
      updatedAt: 0,
    });
    return { taskId, runId };
  });
}

async function seedMetadata(t: T, storageId: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('fileMetadata', {
      organizationId: ORG,
      storageId,
      fileName: storageId,
      contentType: 'application/octet-stream',
      size: 1,
      source: 'task-output',
    });
  });
}

function file(name: string, id: string) {
  return {
    fileId: id,
    fileName: name,
    fileType: 'application/octet-stream',
    fileSize: 1,
  };
}

async function readTask(t: T, taskId: Id<'tasks'>): Promise<Doc<'tasks'>> {
  const task = await t.run((ctx) => ctx.db.get(taskId));
  if (!task) throw new Error('task missing');
  return task;
}

describe('agentRecordTaskOutputs', () => {
  it('appends a first run’s deliverables in harvest order', async () => {
    const t = convexTest(schema, modules);
    const { taskId, runId } = await seedWorld(t);

    await t.mutation(internal.tasks.internal_mutations.agentRecordTaskOutputs, {
      organizationId: ORG,
      taskId,
      runId,
      files: [
        file('deck.pptx', 's3:out/blob-a'),
        file('notes.md', 's3:out/blob-b'),
      ],
    });

    const task = await readTask(t, taskId);
    expect(task.outputs?.map((o) => [o.fileName, o.fileId])).toEqual([
      ['deck.pptx', 's3:out/blob-a'],
      ['notes.md', 's3:out/blob-b'],
    ]);
    expect(task.outputs?.every((o) => o.runId === runId)).toBe(true);
  });

  it('replaces a same-named deliverable and purges the superseded blob', async () => {
    const t = convexTest(schema, modules);
    const { taskId, runId } = await seedWorld(t);
    await seedMetadata(t, 's3:out/blob-old');

    await t.mutation(internal.tasks.internal_mutations.agentRecordTaskOutputs, {
      organizationId: ORG,
      taskId,
      runId,
      files: [file('deck.pptx', 's3:out/blob-old')],
    });
    await t.mutation(internal.tasks.internal_mutations.agentRecordTaskOutputs, {
      organizationId: ORG,
      taskId,
      runId,
      files: [
        file('deck.pptx', 's3:out/blob-new'),
        file('extra.csv', 's3:out/blob-c'),
      ],
    });

    const task = await readTask(t, taskId);
    expect(task.outputs?.map((o) => [o.fileName, o.fileId])).toEqual([
      ['deck.pptx', 's3:out/blob-new'],
      ['extra.csv', 's3:out/blob-c'],
    ]);
    const oldMeta = await t.run((ctx) =>
      ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', 's3:out/blob-old'))
        .first(),
    );
    expect(oldMeta).toBeNull();
  });

  it('leaves the entry alone when a rerun hands back the identical blob', async () => {
    const t = convexTest(schema, modules);
    const { taskId, runId } = await seedWorld(t);
    await seedMetadata(t, 's3:out/blob-same');

    for (let i = 0; i < 2; i++) {
      await t.mutation(
        internal.tasks.internal_mutations.agentRecordTaskOutputs,
        {
          organizationId: ORG,
          taskId,
          runId,
          files: [file('deck.pptx', 's3:out/blob-same')],
        },
      );
    }

    const task = await readTask(t, taskId);
    expect(task.outputs).toHaveLength(1);
    const meta = await t.run((ctx) =>
      ctx.db
        .query('fileMetadata')
        .withIndex('by_storageId', (q) => q.eq('storageId', 's3:out/blob-same'))
        .first(),
    );
    expect(meta).not.toBeNull();
  });

  it('is a no-op for an empty harvest', async () => {
    const t = convexTest(schema, modules);
    const { taskId, runId } = await seedWorld(t);

    await t.mutation(internal.tasks.internal_mutations.agentRecordTaskOutputs, {
      organizationId: ORG,
      taskId,
      runId,
      files: [],
    });

    const task = await readTask(t, taskId);
    expect(task.outputs).toBeUndefined();
  });
});
