import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root. This file lives at
// convex/tasks/, so resolve glob keys against that base (mirrors append_only.test.ts).
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

const ORG = 'org_upsert_external';
type T = TestConvex<typeof schema>;

async function seedProject(t: T, name: string): Promise<Id<'projects'>> {
  return await t.run(async (ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name,
      createdBy: 'user_1',
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

function upsert(
  t: T,
  projectId: Id<'projects'>,
  externalId: string,
  dedupeScope?: 'org' | 'project',
) {
  return t.mutation(
    internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
    {
      organizationId: ORG,
      actorId: 'user_1',
      projectId,
      externalSystem: 'github',
      externalId,
      title: `Issue ${externalId}`,
      externalState: 'open',
      ...(dedupeScope ? { dedupeScope } : {}),
    },
  );
}

async function taskProjectId(t: T, taskId: string): Promise<string> {
  return await t.run(async (ctx) => {
    const task = await ctx.db.get(taskId as Id<'tasks'>);
    if (!task) throw new Error('task not found');
    return String(task.projectId);
  });
}

describe('agentUpsertTaskByExternalRef — dedup scope', () => {
  it("dedupeScope:'project' — same issue in two projects yields two independent tasks", async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');
    const projectB = await seedProject(t, 'Beta');

    const a = await upsert(t, projectA, 'owner/repo#1925', 'project');
    const b = await upsert(t, projectB, 'owner/repo#1925', 'project');

    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(a.taskId).not.toBe(b.taskId);
    // Each task lives in its OWN project — the second create did not retarget the first.
    expect(await taskProjectId(t, a.taskId)).toBe(String(projectA));
    expect(await taskProjectId(t, b.taskId)).toBe(String(projectB));
  });

  it("dedupeScope:'project' — same issue twice in one project is idempotent", async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');

    const first = await upsert(t, projectA, 'owner/repo#42', 'project');
    const second = await upsert(t, projectA, 'owner/repo#42', 'project');

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.taskId).toBe(first.taskId);
  });

  it("dedupeScope:'org' (default) — same issue across projects dedups to one org-wide task", async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'Alpha');
    const projectB = await seedProject(t, 'Beta');

    // Default scope (arg omitted) must stay org-wide for back-compat with the
    // GitHub sync workflows.
    const a = await upsert(t, projectA, 'owner/repo#7');
    const b = await upsert(t, projectB, 'owner/repo#7');

    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.taskId).toBe(a.taskId);
    // The task stays in the project that first materialized it (projectId is not re-homed).
    expect(await taskProjectId(t, b.taskId)).toBe(String(projectA));
  });
});
