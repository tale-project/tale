import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { taskRowValidator } from './queries';
import { tasksTable } from './schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/tasks/), mirroring internal_mutations.test.ts.
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

const ORG = 'org_external_keys';
type T = TestConvex<typeof schema>;

// Seed the local member mirror so the org-membership gate resolves without the
// (test-unavailable) Better Auth component — mirrors apps/config.test.ts.
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
      createdBy: 'user_1',
      createdAt: 0,
      updatedAt: 0,
    }),
  );
}

function upsertIssue(
  t: T,
  projectId: Id<'projects'>,
  externalSystem: string,
  externalId: string,
) {
  return t.mutation(
    internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
    {
      organizationId: ORG,
      actorId: 'user_1',
      projectId,
      externalSystem,
      externalId,
      title: `Task ${externalId}`,
      externalState: 'open',
    },
  );
}

/** The index the query relies on, read directly so the test pins its shape. */
async function externalKeysViaIndex(
  t: T,
  projectId: Id<'projects'>,
  externalSystem: string,
): Promise<string[]> {
  return await t.run(async (ctx) => {
    const keys: string[] = [];
    for await (const task of ctx.db
      .query('tasks')
      .withIndex('by_project_external', (q) =>
        q.eq('projectId', projectId).eq('externalSystem', externalSystem),
      )) {
      if (task.externalId) keys.push(task.externalId);
    }
    return keys;
  });
}

// Regression guard for a shipped bug: the board/list/table queries return whole
// task docs validated against `taskRowValidator`, and Convex return-validation
// is STRICT — a field stored on a task but missing from the validator makes the
// query throw at runtime, which surfaces as a permanently empty board (no client
// error). `createTask` stamps every task with `number`, so once any task existed
// the query threw on every run — breaking both first paint and live updates.
//
// Asserting validator ⊇ schema catches that drift the moment a new schema field
// lands without being added to the return validator.
describe('taskRowValidator', () => {
  it('covers every tasksTable field', () => {
    const schemaFields = Object.keys(tasksTable.validator.fields);
    const validatorFields = new Set(Object.keys(taskRowValidator.fields));
    const missing = schemaFields.filter((field) => !validatorFields.has(field));
    expect(missing).toEqual([]);
  });
});

describe('listExternalKeysByProject', () => {
  it('returns every matching key, scoped to the project + external system', async () => {
    const t = convexTest(schema, modules);
    const projectA = await seedProject(t, 'A');
    const projectB = await seedProject(t, 'B');

    for (const n of [1, 2, 3, 4, 5]) {
      await upsertIssue(t, projectA, 'github', `tale-project/tale#${n}`);
    }
    await upsertIssue(t, projectA, 'jira', 'PROJ-1'); // other system, same project
    await upsertIssue(t, projectB, 'github', 'tale-project/tale#9'); // other project

    // The query's index read returns the COMPLETE github set for project A —
    // no TASK_BOARD_CAP truncation (an incomplete set would leak tracked issues
    // back into the desk), and nothing from the jira system or project B.
    const keys = await externalKeysViaIndex(t, projectA, 'github');
    expect(keys.sort()).toEqual(
      [1, 2, 3, 4, 5].map((n) => `tale-project/tale#${n}`),
    );
  });

  it('rejects an unauthenticated caller (project ACL gate is wired)', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'A');

    await expect(
      t.query(api.tasks.queries.listExternalKeysByProject, {
        projectId,
        externalSystem: 'github',
      }),
    ).rejects.toThrow();
  });
});

// The board/list hide write controls (Create, the priority/assignee pickers,
// drag-reorder) for read-only viewers off this flag — the server still rejects
// any unauthorized write, so it's a UX/consistency affordance (#2069[57]).
describe('listTasksByProject canEdit', () => {
  it('reports canEdit true for an editor on an org-wide project', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'A'); // org-wide (no teamId)
    await seedMember(t, 'user_editor', 'editor');

    const result = await t
      .withIdentity({ subject: 'user_editor' })
      .query(api.tasks.queries.listTasksByProject, { projectId });
    expect(result.canEdit).toBe(true);
  });

  it('reports canEdit false for a read-only member who can still read', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'A'); // org-wide → readable by all
    await seedMember(t, 'user_member', 'member');

    const result = await t
      .withIdentity({ subject: 'user_member' })
      .query(api.tasks.queries.listTasksByProject, { projectId });
    // Reads succeed (no throw) but writes are gated off.
    expect(result.canEdit).toBe(false);
  });
});
