// Drives the REAL tasks and projects legs through convex-test. The point of
// this file is one behaviour: an archived task or project is RETURNED, not
// filtered. The chat-level tests mock this query away, so without this the
// change is unverified where it actually happens.

import { convexTest, type TestConvex } from 'convex-test';
import { beforeEach, describe, expect, it } from 'vitest';

import { internal } from '../_generated/api';
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

const ORG = 'org_task_search';
type T = TestConvex<typeof schema>;

interface Seeded {
  live: Id<'projects'>;
  retired: Id<'projects'>;
}

async function seed(t: T): Promise<Seeded> {
  return t.run(async (ctx) => {
    const live = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Live project',
      createdBy: 'user_1',
      createdAt: 0,
      updatedAt: 0,
    });
    const retired = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Retired project',
      createdBy: 'user_1',
      createdAt: 0,
      updatedAt: 0,
      archivedAt: 1_700_000_000_000,
    });
    // Every title shares "pricing", so only archive state differs.
    await ctx.db.insert('tasks', {
      organizationId: ORG,
      title: 'Pricing live task',
      status: 'todo',
      rank: 'a',
      projectId: live,
      createdBy: 'user_1',
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    });
    await ctx.db.insert('tasks', {
      organizationId: ORG,
      title: 'Pricing archived task',
      status: 'todo',
      rank: 'b',
      projectId: live,
      createdBy: 'user_1',
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
      archivedAt: 1_700_000_000_000,
    });
    await ctx.db.insert('tasks', {
      organizationId: ORG,
      title: 'Pricing task in retired project',
      status: 'todo',
      rank: 'c',
      projectId: retired,
      createdBy: 'user_1',
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    });
    return { live, retired };
  });
}

describe('searchTasksForChat — archived rows are returned', () => {
  let t: T;
  let ids: Seeded;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    ids = await seed(t);
  });

  it('returns an archived task alongside a live one', async () => {
    const result = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: ORG,
        projectIds: [String(ids.live), String(ids.retired)],
        term: 'pricing',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    const titles = result.page.map((task) => task.title).sort();
    expect(titles).toEqual([
      'Pricing archived task',
      'Pricing live task',
      'Pricing task in retired project',
    ]);
  });

  it('carries archivedAt through, so the caller can label it', async () => {
    const result = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: ORG,
        projectIds: [String(ids.live)],
        term: 'pricing',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    const archived = result.page.find(
      (task) => task.title === 'Pricing archived task',
    );
    expect(archived?.archivedAt).toBeDefined();
  });

  // Archive is orthogonal to the status filter. "Open" still means not done and
  // not cancelled, and an archived task can be either.
  it('still honours the status filter over archived rows', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('tasks', {
        organizationId: ORG,
        title: 'Pricing archived and done',
        status: 'done',
        rank: 'd',
        projectId: ids.live,
        createdBy: 'user_1',
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
        archivedAt: 1,
      });
    });
    const result = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: ORG,
        projectIds: [String(ids.live)],
        term: 'pricing',
        status: 'open',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    const titles = result.page.map((task) => task.title);
    expect(titles).not.toContain('Pricing archived and done');
    expect(titles).toContain('Pricing archived task');
  });

  it('still hides a task whose project the caller cannot read', async () => {
    const result = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: ORG,
        projectIds: [String(ids.live)],
        term: 'pricing',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(result.page.map((task) => task.title)).not.toContain(
      'Pricing task in retired project',
    );
  });
});

describe('searchProjectsForChat — archived projects are returned', () => {
  let t: T;
  let ids: Seeded;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    ids = await seed(t);
  });

  it('returns an archived project alongside a live one', async () => {
    const result = await t.query(
      internal.tasks.search_for_chat.searchProjectsForChat,
      {
        organizationId: ORG,
        projectIds: [String(ids.live), String(ids.retired)],
        term: 'project',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    const names = result.page.map((project) => project.name).sort();
    expect(names).toEqual(['Live project', 'Retired project']);
  });

  it('still hides a project the caller cannot read', async () => {
    const result = await t.query(
      internal.tasks.search_for_chat.searchProjectsForChat,
      {
        organizationId: ORG,
        projectIds: [String(ids.live)],
        term: 'project',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(result.page.map((project) => project.name)).toEqual([
      'Live project',
    ]);
  });
});

// The defect this fixes, observed in production: "are there any open tasks?"
// tokenises to open/tasks/projects, no task title contains those words, and the
// leg correctly returned nothing. Worse, a project whose DESCRIPTION happened to
// contain "tasks" matched instead, which read as an answer.
describe('searchTasksForChat — listing when nothing matches the words', () => {
  let t: T;
  let ids: Seeded;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    ids = await seed(t);
  });

  async function search(term: string, status?: 'open') {
    return t.query(internal.tasks.search_for_chat.searchTasksForChat, {
      organizationId: ORG,
      projectIds: [String(ids.live), String(ids.retired)],
      term,
      ...(status !== undefined ? { status } : {}),
      paginationOpts: { numItems: 20, cursor: null },
    });
  }

  it('lists tasks in scope when the wording matches nothing', async () => {
    const result = await search('open tasks projects');
    expect(result.listed).toBe(true);
    expect(result.page.length).toBeGreaterThan(0);
  });

  it('says it matched, not listed, when the wording does match', async () => {
    const result = await search('pricing');
    expect(result.listed).toBe(false);
    expect(result.page.length).toBeGreaterThan(0);
  });

  it('honours the status filter while listing', async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert('tasks', {
        organizationId: ORG,
        title: 'Zzz finished work',
        status: 'done',
        rank: 'z',
        projectId: ids.live,
        createdBy: 'user_1',
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
      });
    });
    const result = await search('anything unmatchable', 'open');
    expect(result.listed).toBe(true);
    expect(result.page.map((task) => task.title)).not.toContain(
      'Zzz finished work',
    );
  });

  it('never lists a task from a project the caller cannot read', async () => {
    const result = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: ORG,
        projectIds: [String(ids.live)],
        term: 'nothing will match this',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(result.listed).toBe(true);
    expect(result.page.map((task) => task.title)).not.toContain(
      'Pricing task in retired project',
    );
  });

  it('narrows to one project when projectId is given', async () => {
    const result = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: ORG,
        projectIds: [String(ids.live), String(ids.retired)],
        projectId: ids.retired,
        term: '',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(result.page.map((task) => task.title)).toEqual([
      'Pricing task in retired project',
    ]);
  });

  // Narrowing must never widen: a project outside the readable set stays out
  // even when named explicitly.
  it('returns nothing for a projectId outside the readable set', async () => {
    const result = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: ORG,
        projectIds: [String(ids.live)],
        projectId: ids.retired,
        term: '',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(result.page).toEqual([]);
  });
});

describe('searchProjectsForChat — listing when nothing matches', () => {
  let t: T;
  let ids: Seeded;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    ids = await seed(t);
  });

  // "are there any archived projects?" named no project, so only the one whose
  // description happened to contain a query word came back.
  it('lists readable projects when the wording matches nothing', async () => {
    const result = await t.query(
      internal.tasks.search_for_chat.searchProjectsForChat,
      {
        organizationId: ORG,
        projectIds: [String(ids.live), String(ids.retired)],
        term: 'are there any archived projects',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(result.listed).toBe(true);
    expect(result.page.map((p) => p.name).sort()).toEqual([
      'Live project',
      'Retired project',
    ]);
  });

  it('lists only readable projects', async () => {
    const result = await t.query(
      internal.tasks.search_for_chat.searchProjectsForChat,
      {
        organizationId: ORG,
        projectIds: [String(ids.live)],
        term: 'unmatchable wording here',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(result.page.map((p) => p.name)).toEqual(['Live project']);
  });
});
