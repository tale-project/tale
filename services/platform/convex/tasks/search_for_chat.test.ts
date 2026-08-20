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

// WHICH rows the cap keeps. A listing is bounded, so on a board bigger than the
// bound the ordering of the walk decides the whole answer — and the org index
// yields oldest-first, which would have answered "what is open?" with the most
// stale work on the board.
describe('a listing over-capacity keeps the most recently touched rows', () => {
  const BIG_ORG = 'org_task_cap';

  /** 20 open tasks in one readable project, `updatedAt` ascending, so the
   *  oldest and the newest are unambiguous. */
  async function seedOverCap(t: T): Promise<Id<'projects'>> {
    return t.run(async (ctx) => {
      const project = await ctx.db.insert('projects', {
        organizationId: BIG_ORG,
        name: 'Busy project',
        createdBy: 'user_1',
        createdAt: 0,
        updatedAt: 0,
      });
      for (let index = 0; index < 20; index += 1) {
        await ctx.db.insert('tasks', {
          organizationId: BIG_ORG,
          title: `Task ${String(index).padStart(2, '0')}`,
          status: 'todo',
          rank: `r${String(index).padStart(2, '0')}`,
          projectId: project,
          createdBy: 'user_1',
          createdByType: 'user',
          createdAt: 0,
          updatedAt: 1_000 + index,
        });
      }
      return project;
    });
  }

  it('returns the newest 15 open tasks, not the oldest 15', async () => {
    const t = convexTest(schema, modules);
    const project = await seedOverCap(t);

    const result = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: BIG_ORG,
        projectIds: [String(project)],
        term: 'are there any open tasks',
        status: 'open',
        paginationOpts: { numItems: 25, cursor: null },
      },
    );

    expect(result.listed).toBe(true);
    expect(result.page).toHaveLength(15);
    const titles = result.page.map((task) => task.title).sort();
    // Tasks 05..19 are the 15 most recently updated of the 20.
    expect(titles[0]).toBe('Task 05');
    expect(titles.at(-1)).toBe('Task 19');
    // The five oldest are absent — the assertion the org-index walk failed.
    for (const stale of [
      'Task 00',
      'Task 01',
      'Task 02',
      'Task 03',
      'Task 04',
    ]) {
      expect(titles).not.toContain(stale);
    }
  });

  it('still groups the kept page by status, then rank', async () => {
    const t = convexTest(schema, modules);
    const project = await t.run(async (ctx) => {
      const id = await ctx.db.insert('projects', {
        organizationId: 'org_task_order',
        name: 'Ordering project',
        createdBy: 'user_1',
        createdAt: 0,
        updatedAt: 0,
      });
      // Inserted newest-first by updatedAt, so recency order and status order
      // disagree; the returned order must follow status.
      const rows: Array<[string, 'todo' | 'in_progress' | 'backlog']> = [
        ['Newest', 'todo'],
        ['Middle', 'in_progress'],
        ['Oldest', 'backlog'],
      ];
      let updatedAt = 3_000;
      for (const [title, status] of rows) {
        await ctx.db.insert('tasks', {
          organizationId: 'org_task_order',
          title,
          status,
          rank: 'a',
          projectId: id,
          createdBy: 'user_1',
          createdByType: 'user',
          createdAt: 0,
          updatedAt,
        });
        updatedAt -= 1_000;
      }
      return id;
    });

    const result = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: 'org_task_order',
        projectIds: [String(project)],
        term: 'what is on the board',
        paginationOpts: { numItems: 25, cursor: null },
      },
    );

    expect(result.listed).toBe(true);
    // Alphabetical by status: backlog, in_progress, todo.
    expect(result.page.map((task) => task.status)).toEqual([
      'backlog',
      'in_progress',
      'todo',
    ]);
  });

  it('keeps the most recently touched readable projects', async () => {
    const t = convexTest(schema, modules);
    const readable: string[] = [];
    await t.run(async (ctx) => {
      for (let index = 0; index < 20; index += 1) {
        const id = await ctx.db.insert('projects', {
          organizationId: 'org_proj_cap',
          name: `Project ${String(index).padStart(2, '0')}`,
          createdBy: 'user_1',
          createdAt: 0,
          updatedAt: 1_000 + index,
        });
        readable.push(String(id));
      }
    });

    const result = await t.query(
      internal.tasks.search_for_chat.searchProjectsForChat,
      {
        organizationId: 'org_proj_cap',
        projectIds: readable,
        term: 'which projects are there',
        paginationOpts: { numItems: 25, cursor: null },
      },
    );

    expect(result.page).toHaveLength(15);
    const names = result.page.map((project) => project.name).sort();
    expect(names[0]).toBe('Project 05');
    expect(names.at(-1)).toBe('Project 19');
  });
});

// The scan budget. A listing filters as it walks, so a caller who can read
// little rejects most rows — and without a bound on rows EXAMINED, one board
// question would read the organization's whole tasks index.
describe('a listing bounds what it examines, not just what it keeps', () => {
  const SCAN_ORG = 'org_task_scan';

  it('reports an incomplete listing when the scan budget stops the walk', async () => {
    const t = convexTest(schema, modules);
    // 600 tasks in a project the caller cannot read, so every row is rejected.
    // The default budget is 500, so the walk stops before the index ends.
    const unreadable = await t.run(async (ctx) => {
      const project = await ctx.db.insert('projects', {
        organizationId: SCAN_ORG,
        name: 'Hidden project',
        createdBy: 'user_1',
        createdAt: 0,
        updatedAt: 0,
      });
      for (let index = 0; index < 600; index += 1) {
        await ctx.db.insert('tasks', {
          organizationId: SCAN_ORG,
          title: `Hidden ${index}`,
          status: 'todo',
          rank: 'a',
          projectId: project,
          createdBy: 'user_1',
          createdByType: 'user',
          createdAt: 0,
          updatedAt: 1_000 + index,
        });
      }
      return project;
    });

    const result = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: SCAN_ORG,
        // Reads nothing: the one project in the org is not in the set.
        projectIds: [],
        term: 'are there any open tasks',
        status: 'open',
        paginationOpts: { numItems: 25, cursor: null },
      },
    );

    expect(String(unreadable)).not.toBe('');
    expect(result.listed).toBe(true);
    // Nothing readable, and the walk stopped at the budget rather than proving
    // the board empty — so the listing does not claim to be complete.
    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(false);
  });

  it('reports an incomplete projects listing on the same budget', async () => {
    const t = convexTest(schema, modules);
    // 600 projects, none readable, so the walk stops at the budget having kept
    // nothing — and must not claim it saw the whole org.
    await t.run(async (ctx) => {
      for (let index = 0; index < 600; index += 1) {
        await ctx.db.insert('projects', {
          organizationId: 'org_proj_scan',
          name: `Hidden ${index}`,
          createdBy: 'user_1',
          createdAt: 0,
          updatedAt: 1_000 + index,
        });
      }
    });

    const result = await t.query(
      internal.tasks.search_for_chat.searchProjectsForChat,
      {
        organizationId: 'org_proj_scan',
        projectIds: [],
        term: 'which projects are there',
        paginationOpts: { numItems: 25, cursor: null },
      },
    );

    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(false);
  });

  it('reports a complete listing when the whole board fits in the budget', async () => {
    const t = convexTest(schema, modules);
    const project = await t.run(async (ctx) => {
      const id = await ctx.db.insert('projects', {
        organizationId: 'org_task_small',
        name: 'Small project',
        createdBy: 'user_1',
        createdAt: 0,
        updatedAt: 0,
      });
      await ctx.db.insert('tasks', {
        organizationId: 'org_task_small',
        title: 'Only task',
        status: 'todo',
        rank: 'a',
        projectId: id,
        createdBy: 'user_1',
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 1_000,
      });
      return id;
    });

    const result = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: 'org_task_small',
        projectIds: [String(project)],
        term: 'are there any open tasks',
        status: 'open',
        paginationOpts: { numItems: 25, cursor: null },
      },
    );

    expect(result.listed).toBe(true);
    expect(result.page).toHaveLength(1);
    expect(result.isDone).toBe(true);
  });
});

describe('explicit list mode — the chat list action backend', () => {
  const LIST_ORG = 'org_task_list';
  let t: T;
  let project: Id<'projects'>;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    project = await t.run(async (ctx) => {
      const id = await ctx.db.insert('projects', {
        organizationId: LIST_ORG,
        name: 'Board project',
        createdBy: 'user_1',
        createdAt: 0,
        updatedAt: 0,
      });
      // Five live tasks and one archived — updated newest-first is t5..t1.
      for (let i = 1; i <= 5; i += 1) {
        await ctx.db.insert('tasks', {
          organizationId: LIST_ORG,
          title: `Board task ${i}`,
          status: 'todo',
          rank: String(i),
          projectId: id,
          createdBy: 'user_1',
          createdByType: 'user',
          createdAt: i,
          updatedAt: i * 1_000,
        });
      }
      await ctx.db.insert('tasks', {
        organizationId: LIST_ORG,
        title: 'Archived board task',
        status: 'todo',
        rank: 'z',
        projectId: id,
        createdBy: 'user_1',
        createdByType: 'user',
        createdAt: 9,
        updatedAt: 9_000,
        archivedAt: 1_700_000_000_000,
      });
      return id;
    });
  });

  it('honours the requested page size and returns a redeemable cursor', async () => {
    const first = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: LIST_ORG,
        projectIds: [String(project)],
        term: '',
        list: true,
        status: 'open',
        paginationOpts: { numItems: 2, cursor: null },
      },
    );
    expect(first.listed).toBe(true);
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    expect(first.continueCursor).not.toBe('');

    const second = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: LIST_ORG,
        projectIds: [String(project)],
        term: '',
        list: true,
        status: 'open',
        paginationOpts: { numItems: 2, cursor: first.continueCursor },
      },
    );
    // The next page carries DIFFERENT rows — the cursor really resumed.
    const firstIds = new Set(first.page.map((task) => String(task._id)));
    expect(second.page.length).toBeGreaterThan(0);
    for (const task of second.page) {
      expect(firstIds.has(String(task._id))).toBe(false);
    }
  });

  it('excludes archived rows only when asked — the current board reading', async () => {
    const listed = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: LIST_ORG,
        projectIds: [String(project)],
        term: '',
        list: true,
        excludeArchived: true,
        status: 'open',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(
      listed.page.some((task) => task.title === 'Archived board task'),
    ).toBe(false);

    // Without the flag the archive policy stays: returned, not filtered.
    const unfiltered = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: LIST_ORG,
        projectIds: [String(project)],
        term: '',
        list: true,
        status: 'open',
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(
      unfiltered.page.some((task) => task.title === 'Archived board task'),
    ).toBe(true);
  });

  it('narrows a projectId list to that project alone', async () => {
    const other = await t.run(async (ctx) =>
      ctx.db.insert('projects', {
        organizationId: LIST_ORG,
        name: 'Other project',
        createdBy: 'user_1',
        createdAt: 0,
        updatedAt: 0,
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert('tasks', {
        organizationId: LIST_ORG,
        title: 'Other project task',
        status: 'todo',
        rank: 'y',
        projectId: other,
        createdBy: 'user_1',
        createdByType: 'user',
        createdAt: 8,
        updatedAt: 8_000,
      });
    });
    const narrowed = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: LIST_ORG,
        projectIds: [String(project), String(other)],
        term: '',
        list: true,
        projectId: project,
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(narrowed.page.length).toBeGreaterThan(0);
    expect(
      narrowed.page.every((task) => String(task.projectId) === String(project)),
    ).toBe(true);
  });

  it('lists projects the same way, with archived excluded on request', async () => {
    const retired = await t.run(async (ctx) =>
      ctx.db.insert('projects', {
        organizationId: LIST_ORG,
        name: 'Retired board project',
        createdBy: 'user_1',
        createdAt: 0,
        updatedAt: 0,
        archivedAt: 1_700_000_000_000,
      }),
    );
    const listed = await t.query(
      internal.tasks.search_for_chat.searchProjectsForChat,
      {
        organizationId: LIST_ORG,
        projectIds: [String(project), String(retired)],
        term: '',
        list: true,
        excludeArchived: true,
        paginationOpts: { numItems: 20, cursor: null },
      },
    );
    expect(listed.listed).toBe(true);
    expect(listed.page.map((row) => row.name)).toEqual(['Board project']);
  });

  // The implicit fallback (no `list` flag) must stay byte-identical: its own
  // fixed cap, no cursor — asserted by the "newest 15" suite above. This
  // pins the boundary from the other side: the flag is what opts in.
  it('keeps the fallback cap when the flag is absent', async () => {
    const fallback = await t.query(
      internal.tasks.search_for_chat.searchTasksForChat,
      {
        organizationId: LIST_ORG,
        projectIds: [String(project)],
        term: 'zebra nonsense words',
        paginationOpts: { numItems: 2, cursor: null },
      },
    );
    expect(fallback.listed).toBe(true);
    // numItems 2 is IGNORED by the fallback (its cap is LIST_CAP) — all six
    // readable tasks fit under 15 and come back despite the tiny page ask.
    expect(fallback.page.length).toBeGreaterThan(2);
    expect(fallback.continueCursor).toBe('');
  });
});
