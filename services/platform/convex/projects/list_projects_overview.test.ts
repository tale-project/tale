import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import schema from '../schema';

// convex-test module map keyed relative to the convex/ root (this file is at
// convex/projects/), mirroring queries.test.ts.
const TEST_DIR_FROM_CONVEX_ROOT = 'projects';
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

const ORG = 'org_overview';
const OTHER_ORG = 'org_other';
const USER = 'user_1';
const IDENTITY = { subject: USER };
const NOW = 1_700_000_000_000;
const DAY = 86_400_000;
type T = TestConvex<typeof schema>;
type Status = Doc<'tasks'>['status'];

async function seedMember(t: T, organizationId: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${USER}_${organizationId}`,
      userId: USER,
      organizationId,
      role: 'member',
      createdAt: 0,
    });
  });
}

async function seedProject(
  t: T,
  opts: {
    organizationId?: string;
    name?: string;
    open?: number;
    done?: number;
    agents?: number;
    teamId?: string;
  } = {},
): Promise<Id<'projects'>> {
  return await t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId: opts.organizationId ?? ORG,
      name: opts.name ?? 'Roadmap',
      createdBy: USER,
      createdAt: 0,
      updatedAt: 0,
      openTaskCount: opts.open ?? 0,
      doneTaskCount: opts.done ?? 0,
      projectAgentCount: opts.agents ?? 0,
      ...(opts.teamId ? { teamId: opts.teamId } : {}),
    }),
  );
}

let rank = 0;
async function seedTask(
  t: T,
  projectId: Id<'projects'>,
  opts: {
    organizationId?: string;
    status?: Status;
    dueDate?: number;
    archivedAt?: number;
  } = {},
): Promise<void> {
  rank += 1;
  await t.run((ctx) =>
    ctx.db.insert('tasks', {
      organizationId: opts.organizationId ?? ORG,
      projectId,
      title: `Task ${rank}`,
      status: opts.status ?? 'todo',
      rank: `a${rank}`,
      number: rank,
      createdBy: USER,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
      ...(opts.dueDate !== undefined ? { dueDate: opts.dueDate } : {}),
      ...(opts.archivedAt !== undefined ? { archivedAt: opts.archivedAt } : {}),
    }),
  );
}

function run(t: T, args: { asOf?: number; includeArchived?: boolean } = {}) {
  return t
    .withIdentity(IDENTITY)
    .query(api.projects.queries.listProjectsOverview, {
      organizationId: ORG,
      asOf: args.asOf ?? NOW,
      ...(args.includeArchived !== undefined
        ? { includeArchived: args.includeArchived }
        : {}),
    });
}

describe('listProjectsOverview', () => {
  it('returns the denormalized counters off the project row', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG);
    await seedProject(t, { open: 7, done: 3, agents: 2 });

    const result = await run(t);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      openTaskCount: 7,
      doneTaskCount: 3,
      projectAgentCount: 2,
    });
    expect(result.overdueTruncated).toBe(false);
  });

  it('defaults missing counters to 0 rather than leaking undefined', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG);
    // A project from before the backfill: no counter fields at all.
    await t.run((ctx) =>
      ctx.db.insert('projects', {
        organizationId: ORG,
        name: 'Legacy',
        createdBy: USER,
        createdAt: 0,
        updatedAt: 0,
      }),
    );

    const result = await run(t);

    expect(result.projects[0]).toMatchObject({
      openTaskCount: 0,
      doneTaskCount: 0,
      projectAgentCount: 0,
      overdueTaskCount: 0,
    });
  });

  it('counts only live, non-terminal, past-due tasks as overdue', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG);
    const projectId = await seedProject(t);

    await seedTask(t, projectId, { dueDate: NOW - DAY }); // counts
    await seedTask(t, projectId, { dueDate: NOW - 2 * DAY }); // counts
    await seedTask(t, projectId, { dueDate: NOW + DAY }); // future
    await seedTask(t, projectId, {}); // no due date
    await seedTask(t, projectId, { dueDate: NOW - DAY, status: 'done' });
    await seedTask(t, projectId, { dueDate: NOW - DAY, status: 'cancelled' });
    await seedTask(t, projectId, { dueDate: NOW - DAY, archivedAt: NOW });

    const result = await run(t);

    expect(result.projects[0]?.overdueTaskCount).toBe(2);
  });

  it('honours asOf so the count reflects the caller clock, not query time', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG);
    const projectId = await seedProject(t);
    await seedTask(t, projectId, { dueDate: NOW - DAY });

    // Rewind the clock to before the due date — nothing is overdue yet.
    const past = await run(t, { asOf: NOW - 2 * DAY });
    expect(past.projects[0]?.overdueTaskCount).toBe(0);

    const present = await run(t);
    expect(present.projects[0]?.overdueTaskCount).toBe(1);
  });

  it('buckets overdue per project instead of pooling them', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG);
    const a = await seedProject(t, { name: 'A' });
    const b = await seedProject(t, { name: 'B' });
    await seedTask(t, a, { dueDate: NOW - DAY });
    await seedTask(t, a, { dueDate: NOW - DAY });
    await seedTask(t, b, { dueDate: NOW - DAY });

    const result = await run(t);
    const byName = Object.fromEntries(
      result.projects.map((p) => [p.name, p.overdueTaskCount]),
    );
    expect(byName).toEqual({ A: 2, B: 1 });
  });

  it('ignores another organization overdue tasks', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG);
    await seedProject(t, { name: 'Mine' });
    const theirs = await seedProject(t, {
      organizationId: OTHER_ORG,
      name: 'Theirs',
    });
    await seedTask(t, theirs, {
      organizationId: OTHER_ORG,
      dueDate: NOW - DAY,
    });

    const result = await run(t);

    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      name: 'Mine',
      overdueTaskCount: 0,
    });
  });

  it('omits a project the caller cannot access while its neighbour still counts correctly', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG);
    const mine = await seedProject(t, { name: 'Mine' });
    // Team-scoped to a team this member is not in.
    const hidden = await seedProject(t, {
      name: 'Hidden',
      teamId: 'team_secret',
    });
    await seedTask(t, hidden, { dueDate: NOW - DAY });
    await seedTask(t, mine, { dueDate: NOW - DAY });

    const result = await run(t);

    expect(result.projects.map((p) => p.name)).toEqual(['Mine']);
    expect(result.projects[0]).toMatchObject({
      overdueTaskCount: 1,
    });
  });

  it('excludes archived projects unless asked for them', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG);
    await seedProject(t, { name: 'Live' });
    const archived = await seedProject(t, { name: 'Shelved' });
    await t.run((ctx) => ctx.db.patch(archived, { archivedAt: NOW }));

    expect((await run(t)).projects.map((p) => p.name)).toEqual(['Live']);
    expect(
      (await run(t, { includeArchived: true })).projects
        .map((p) => p.name)
        .sort(),
    ).toEqual(['Live', 'Shelved']);
  });
});
