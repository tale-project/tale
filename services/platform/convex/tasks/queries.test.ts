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

async function seedTask(
  t: T,
  projectId: Id<'projects'>,
  assigneeId?: string,
): Promise<Id<'tasks'>> {
  return await t.run((ctx) =>
    ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Task',
      status: 'todo',
      rank: 'a0',
      number: 1,
      createdBy: 'user_1',
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
      ...(assigneeId ? { assigneeType: 'user' as const, assigneeId } : {}),
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
        // Matching org so the call passes the active-org guard and reaches the
        // auth gate this test is exercising.
        organizationId: ORG,
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
      .query(api.tasks.queries.listTasksByProject, {
        projectId,
        organizationId: ORG,
      });
    expect(result.canEdit).toBe(true);
  });

  it('reports canEdit false for a read-only member who can still read', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'A'); // org-wide → readable by all
    await seedMember(t, 'user_member', 'member');

    const result = await t
      .withIdentity({ subject: 'user_member' })
      .query(api.tasks.queries.listTasksByProject, {
        projectId,
        organizationId: ORG,
      });
    // Reads succeed (no throw) but writes are gated off.
    expect(result.canEdit).toBe(false);
  });
});

// The board/list query passes every lane status (including `backlog`).
describe('listTasksByProject statuses filter', () => {
  async function seedStatusMix(t: T): Promise<Id<'projects'>> {
    const projectId = await seedProject(t, 'A');
    await seedMember(t, 'user_editor', 'editor');
    await t.run(async (ctx) => {
      let number = 1;
      for (const status of ['backlog', 'todo', 'done'] as const) {
        await ctx.db.insert('tasks', {
          organizationId: ORG,
          projectId,
          title: `Task ${status}`,
          status,
          rank: `a${number}`,
          number: number++,
          createdBy: 'user_1',
          createdByType: 'user',
          createdAt: 0,
          updatedAt: 0,
        });
      }
    });
    return projectId;
  }

  it('includes backlog when scoped to board lane statuses', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedStatusMix(t);

    const result = await t
      .withIdentity({ subject: 'user_editor' })
      .query(api.tasks.queries.listTasksByProject, {
        projectId,
        organizationId: ORG,
        statuses: [
          'backlog',
          'todo',
          'in_progress',
          'in_review',
          'done',
          'cancelled',
        ],
      });
    expect(result.tasks.map((task) => task.status).sort()).toEqual([
      'backlog',
      'done',
      'todo',
    ]);
  });

  it('can still scope to backlog only when callers need it', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedStatusMix(t);

    const result = await t
      .withIdentity({ subject: 'user_editor' })
      .query(api.tasks.queries.listTasksByProject, {
        projectId,
        organizationId: ORG,
        statuses: ['backlog'],
      });
    expect(result.tasks.map((task) => task.status)).toEqual(['backlog']);
  });

  it('returns every status when the scope is omitted (back-compat)', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedStatusMix(t);

    const result = await t
      .withIdentity({ subject: 'user_editor' })
      .query(api.tasks.queries.listTasksByProject, {
        projectId,
        organizationId: ORG,
      });
    expect(result.tasks).toHaveLength(3);
  });
});

// Commenting is a READ-level action on the unified task_discussion surface: any
// org member who can read a task may post, exactly like a project discussion
// reply — so `getTask` reports canComment true even for a read-only member who
// cannot edit the task. The modal gates the comment composer off this flag, not
// canEdit, so a plain member (including a task's own assignee) keeps a composer
// instead of a fully read-only modal (#2339).
describe('getTask canComment', () => {
  it('reports canComment true (canEdit false) for a read-only member', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'A'); // org-wide → readable by all
    const taskId = await seedTask(t, projectId, 'user_member'); // member is the assignee
    await seedMember(t, 'user_member', 'member');

    const result = await t
      .withIdentity({ subject: 'user_member' })
      .query(api.tasks.queries.getTask, { taskId, organizationId: ORG });

    expect(result).not.toBeNull();
    // A read-only member cannot edit the task…
    expect(result?.canEdit).toBe(false);
    // …but CAN comment on it (the composer stays available).
    expect(result?.canComment).toBe(true);
  });
});

// The tasks domain derives access from the parent project via
// `loadAccessibleProject`, which now enforces active-org coherence: a task or
// project carried over from another org (a stale URL after an org switch) is
// denied even when the caller is a member of that other org. The project EXISTS
// here (seeded in ORG), so a reject on a different active org is the coherence
// guard firing, not "project not found". Projects analogue: projects/queries.test.ts.
describe('tasks active-org coherence', () => {
  it('denies a project read when the active org does not match', async () => {
    const t = convexTest(schema, modules);
    const projectId = await seedProject(t, 'Roadmap');

    await expect(
      t.query(api.tasks.queries.listExternalKeysByProject, {
        projectId,
        organizationId: 'org_other',
        externalSystem: 'github',
      }),
    ).rejects.toThrow(/different organization/i);
  });
});

// The task-first reconcile enumerates the board's OPEN github tasks and rechecks
// each issue's state. This pins the enumeration: only non-terminal tasks, only
// the exact repo (the "#"→"$" range boundary must not leak a sibling repo whose
// name extends this one, e.g. `tale-x`), parsed into the issue refs get_issue
// needs. A regression here reintroduces the class of bug this reconcile replaced
// (tasks silently skipped → their closed issues never close the task).
describe('listOpenExternalTaskRefs', () => {
  it('returns only non-terminal tasks for the exact repo, parsed into refs', async () => {
    const t = convexTest(schema, modules);
    const project = await seedProject(t, 'Desk');

    // Non-terminal, repo "tale" → returned.
    await upsertIssue(t, project, 'github', 'tale-project/tale#2033');
    await upsertIssue(t, project, 'github', 'tale-project/tale#2117');
    // Closed on create by the SYNC engine (actorId 'workflow', the only actor
    // that may complete) → the task lands as `done` (terminal) → excluded
    // (this pass only closes still-open work, never revisits terminal tasks).
    await t.mutation(
      internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
      {
        organizationId: ORG,
        actorId: 'workflow',
        projectId: project,
        externalSystem: 'github',
        externalId: 'tale-project/tale#500',
        title: 'already closed',
        externalState: 'closed',
      },
    );
    // Sibling repo whose name extends "tale" → must NOT leak past the
    // "tale-project/tale#".."tale-project/tale$" range boundary.
    await upsertIssue(t, project, 'github', 'tale-project/tale-x#1');
    // Different owner, and a non-github system → both excluded.
    await upsertIssue(t, project, 'github', 'other-org/tale#7');
    await upsertIssue(t, project, 'jira', 'tale-project/tale#42');

    const refs = await t.query(
      internal.tasks.internal_queries.listOpenExternalTaskRefs,
      {
        organizationId: ORG,
        externalSystem: 'github',
        owner: 'tale-project',
        repo: 'tale',
      },
    );

    expect(
      refs
        .map(({ externalId, owner, repo, issueNumber }) => ({
          externalId,
          owner,
          repo,
          issueNumber,
        }))
        .sort((a, b) => a.issueNumber - b.issueNumber),
    ).toEqual([
      {
        externalId: 'tale-project/tale#2033',
        owner: 'tale-project',
        repo: 'tale',
        issueNumber: 2033,
      },
      {
        externalId: 'tale-project/tale#2117',
        owner: 'tale-project',
        repo: 'tale',
        issueNumber: 2117,
      },
    ]);
    expect(refs.every((r) => typeof r.taskId === 'string')).toBe(true);
  });
});

describe('listTasksForAccessibleProjects', () => {
  async function seedTeam(t: T, userId: string, teamId: string): Promise<void> {
    await t.run((ctx) =>
      ctx.db.insert('teamMemberMirror', {
        teamMemberId: `tm_${userId}_${teamId}`,
        userId,
        teamId,
        createdAt: 0,
      }),
    );
  }

  it('returns tasks from every accessible project and stamps projectKey', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'user_editor', 'editor');
    const projectA = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'A',
        key: 'AAA',
        createdBy: 'user_1',
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const projectB = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'B',
        key: 'BBB',
        createdBy: 'user_1',
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    await seedTask(t, projectA);
    await seedTask(t, projectB);

    const result = await t
      .withIdentity({ subject: 'user_editor' })
      .query(api.tasks.queries.listTasksForAccessibleProjects, {
        organizationId: ORG,
      });
    expect(result.canEdit).toBe(false);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.map((task) => task.projectKey).sort()).toEqual([
      'AAA',
      'BBB',
    ]);
  });

  it('excludes tasks in team-private projects the caller cannot read', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'user_member', 'member');
    const open = await seedProject(t, 'Open');
    const hidden = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Hidden',
        teamId: 'team_hidden',
        createdBy: 'user_1',
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const openTask = await seedTask(t, open);
    await seedTask(t, hidden);

    const result = await t
      .withIdentity({ subject: 'user_member' })
      .query(api.tasks.queries.listTasksForAccessibleProjects, {
        organizationId: ORG,
      });
    expect(result.tasks.map((task) => task._id)).toEqual([openTask]);
  });

  it('includes team-private tasks when the caller is on that team', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'user_member', 'member');
    await seedTeam(t, 'user_member', 'team_hidden');
    const hidden = await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Hidden',
        teamId: 'team_hidden',
        createdBy: 'user_1',
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    const taskId = await seedTask(t, hidden);

    const result = await t
      .withIdentity({ subject: 'user_member' })
      .query(api.tasks.queries.listTasksForAccessibleProjects, {
        organizationId: ORG,
      });
    expect(result.tasks.map((task) => task._id)).toEqual([taskId]);
  });

  it('honours the statuses facet', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, 'user_editor', 'editor');
    const projectId = await seedProject(t, 'A');
    await t.run(async (ctx) => {
      for (const status of ['todo', 'done'] as const) {
        await ctx.db.insert('tasks', {
          organizationId: ORG,
          projectId,
          title: status,
          status,
          rank: 'a0',
          number: 1,
          createdBy: 'user_1',
          createdByType: 'user',
          createdAt: 0,
          updatedAt: 0,
        });
      }
    });

    const result = await t
      .withIdentity({ subject: 'user_editor' })
      .query(api.tasks.queries.listTasksForAccessibleProjects, {
        organizationId: ORG,
        statuses: ['todo'],
      });
    expect(result.tasks.map((task) => task.status)).toEqual(['todo']);
  });
});
