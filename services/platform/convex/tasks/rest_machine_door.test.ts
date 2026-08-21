// The tasks machine door, driven end-to-end through a real convex-test
// backend: the create door's upsert is idempotent PER PROJECT and attributes
// the key's minting user as creator; the read gate collapses garbage,
// cross-org, and invisible ids into the same nothing; the start seam answers
// null for an undeployed slug and the in-flight run for a duplicate (the
// handler's not_started / already_running mapping is pinned in
// rest_api.test.ts); and the comment lane lands a USER-authored comment
// through the same core as the session mutation, READ-gate enforced. The
// wire-level statuses (400s, opaque 404 bodies, buckets) live in
// rest_api.test.ts.

import agentComponent from '@convex-dev/agent/test';
import rateLimiterComponent from '@convex-dev/rate-limiter/test';
import { convexTest, type TestConvex } from 'convex-test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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

const ORG = 'org_task_door';
const OTHER_ORG = 'org_task_door_b';
const EDITOR = 'u_task_door_editor';
const OUTSIDER = 'u_task_door_outsider';

type T = TestConvex<typeof schema>;
const testBackends = new Set<T>();

beforeAll(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.all(
    [...testBackends].map((t) => t.finishInProgressScheduledFunctions()),
  );
  testBackends.clear();
});

function makeT(): T {
  const t = convexTest(schema, modules);
  rateLimiterComponent.register(t);
  agentComponent.register(t);
  testBackends.add(t);
  return t;
}

async function seedMember(
  t: T,
  userId: string,
  organizationId: string,
  role: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${userId}_${organizationId}`,
      userId,
      organizationId,
      role,
      createdAt: 0,
    });
  });
}

async function seedProject(
  t: T,
  extra: Partial<Doc<'projects'>> = {},
): Promise<Id<'projects'>> {
  return t.run((ctx) =>
    ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Acme Books',
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
      ...extra,
    }),
  );
}

async function seedTask(
  t: T,
  projectId: Id<'projects'>,
  extra: Partial<Doc<'tasks'>> = {},
): Promise<Id<'tasks'>> {
  return t.run((ctx) =>
    ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Prepare VAT return',
      status: 'todo',
      rank: 'a0',
      createdBy: EDITOR,
      createdByType: 'user',
      createdAt: 1,
      updatedAt: 2,
      ...extra,
    }),
  );
}

/** The exact upsert call the REST create handler makes (see rest_api.ts). */
function upsertAsDoor(
  t: T,
  projectId: Id<'projects'>,
  extra: Record<string, unknown> = {},
): Promise<{ taskId: Id<'tasks'> | null; created: boolean }> {
  return t.mutation(
    internal.tasks.internal_mutations.agentUpsertTaskByExternalRef,
    {
      organizationId: ORG,
      actorId: EDITOR,
      projectId,
      externalSystem: 'github',
      externalId: 'acme/books#7',
      title: 'Prepare VAT return',
      externalState: 'open',
      creatorType: 'user',
      dedupeScope: 'project',
      ...extra,
    },
  );
}

function getTaskForUser(
  t: T,
  taskId: string,
  options: { userId?: string; organizationId?: string } = {},
) {
  return t.query(internal.tasks.rest_api.restGetTaskForUser, {
    organizationId: options.organizationId ?? ORG,
    userId: options.userId ?? EDITOR,
    taskId,
  });
}

function codeOf(error: unknown): string | undefined {
  const raw = (error as { data?: unknown }).data;
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return typeof data === 'object' && data !== null && 'code' in data
    ? String((data as { code: unknown }).code)
    : undefined;
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  const error = await p.then(
    () => {
      throw new Error(`expected a rejection with code ${code}`);
    },
    (err: unknown) => err,
  );
  expect(codeOf(error)).toBe(code);
}

describe('create door (the session upsert with the REST args)', () => {
  it('creates once, then answers the SAME task with created: false', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    const projectId = await seedProject(t);

    const first = await upsertAsDoor(t, projectId, {
      description: 'Q1 filing',
      externalUrl: 'https://github.com/acme/books/issues/7',
    });
    expect(first.created).toBe(true);
    expect(first.taskId).toBeTruthy();

    const row = await t.run(async (ctx) =>
      first.taskId ? await ctx.db.get(first.taskId) : null,
    );
    expect(row).toMatchObject({
      organizationId: ORG,
      projectId,
      title: 'Prepare VAT return',
      status: 'backlog',
      createdBy: EDITOR,
      createdByType: 'user',
      externalSystem: 'github',
      externalId: 'acme/books#7',
      externalUrl: 'https://github.com/acme/books/issues/7',
      description: 'Q1 filing',
    });

    const again = await upsertAsDoor(t, projectId);
    expect(again.created).toBe(false);
    expect(again.taskId).toBe(first.taskId);

    const all = await t.run((ctx) =>
      ctx.db
        .query('tasks')
        .withIndex('by_project', (q) => q.eq('projectId', projectId))
        .collect(),
    );
    expect(all).toHaveLength(1);
  });

  it('dedupes PER PROJECT: the same ref in another project is an independent task', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    const projectA = await seedProject(t);
    const projectB = await seedProject(t, { name: 'Beta Books' });

    const a = await upsertAsDoor(t, projectA);
    const b = await upsertAsDoor(t, projectB);
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(b.taskId).not.toBe(a.taskId);
  });

  it('resolves labels through the shared catalog and refuses invalid ones', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    const projectId = await seedProject(t);

    const created = await upsertAsDoor(t, projectId, { labels: ['VAT '] });
    const row = await t.run(async (ctx) =>
      created.taskId ? await ctx.db.get(created.taskId) : null,
    );
    expect(row?.labelIds).toHaveLength(1);

    await expectCode(
      upsertAsDoor(t, projectId, {
        externalId: 'acme/books#8',
        labels: [''],
      }),
      'TASK_LABELS_INVALID',
    );
  });
});

describe('automation attribution through the door', () => {
  it('automationSlug makes the automation the assignee on create', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    const projectId = await seedProject(t);

    const created = await upsertAsDoor(t, projectId, {
      automationSlug: 'vat-return-desk',
    });
    const row = await t.run(async (ctx) =>
      created.taskId ? await ctx.db.get(created.taskId) : null,
    );
    expect(row).toMatchObject({
      assigneeType: 'app',
      assigneeId: 'vat-return-desk',
      createdBy: EDITOR,
      createdByType: 'user',
    });
  });

  it('a re-pick BACKFILLS a missing attribution, and only a missing one', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    const projectId = await seedProject(t);

    // Created without an owner — the machine-door hole this fixes.
    const bare = await upsertAsDoor(t, projectId);
    let row = await t.run(async (ctx) =>
      bare.taskId ? await ctx.db.get(bare.taskId) : null,
    );
    expect(row?.assigneeId).toBeUndefined();

    // The re-pick that names the owner fills the void…
    const repick = await upsertAsDoor(t, projectId, {
      automationSlug: 'vat-return-desk',
    });
    expect(repick.created).toBe(false);
    expect(repick.taskId).toBe(bare.taskId);
    row = await t.run(async (ctx) =>
      bare.taskId ? await ctx.db.get(bare.taskId) : null,
    );
    expect(row).toMatchObject({
      assigneeType: 'app',
      assigneeId: 'vat-return-desk',
    });

    // …and never clobbers an assignee someone already set.
    await t.run(async (ctx) => {
      if (bare.taskId) {
        await ctx.db.patch(bare.taskId, {
          assigneeType: 'user',
          assigneeId: 'u_human_triage',
        });
      }
    });
    await upsertAsDoor(t, projectId, { automationSlug: 'another-desk' });
    row = await t.run(async (ctx) =>
      bare.taskId ? await ctx.db.get(bare.taskId) : null,
    );
    expect(row).toMatchObject({
      assigneeType: 'user',
      assigneeId: 'u_human_triage',
    });
  });
});

describe('restGetTaskForUser (the read gate, re-run for the minting user)', () => {
  it('answers the poll projection with resolved label names', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    const projectId = await seedProject(t);
    const created = await upsertAsDoor(t, projectId, {
      description: 'Q1 filing',
      externalUrl: 'https://github.com/acme/books/issues/7',
      labels: ['VAT'],
    });

    const task = await getTaskForUser(t, String(created.taskId));
    expect(task).toMatchObject({
      _id: created.taskId,
      title: 'Prepare VAT return',
      status: 'backlog',
      projectId,
      externalSystem: 'github',
      externalId: 'acme/books#7',
      externalUrl: 'https://github.com/acme/books/issues/7',
      description: 'Q1 filing',
      labels: ['vat'],
    });
    expect(task?.createdAt).toEqual(expect.any(Number));
    expect(task?.updatedAt).toEqual(expect.any(Number));
  });

  it('collapses garbage, cross-org, and invisible ids into null', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    await seedMember(t, EDITOR, OTHER_ORG, 'editor');
    await seedMember(t, OUTSIDER, ORG, 'member');

    const visibleProject = await seedProject(t);
    const visibleTask = await seedTask(t, visibleProject);
    const restrictedProject = await seedProject(t, {
      name: 'Team-only',
      teamId: 'team_hidden',
    });
    const restrictedTask = await seedTask(t, restrictedProject);

    // Visible: an org-wide project answers for any member.
    expect(await getTaskForUser(t, String(visibleTask))).not.toBeNull();
    expect(
      await getTaskForUser(t, String(visibleTask), { userId: OUTSIDER }),
    ).not.toBeNull();

    // Garbage id.
    expect(await getTaskForUser(t, 'not-a-task-id')).toBeNull();
    // Cross-org id (the caller resolved OTHER_ORG).
    expect(
      await getTaskForUser(t, String(visibleTask), {
        organizationId: OTHER_ORG,
      }),
    ).toBeNull();
    // Team-restricted project: invisible to members outside the team —
    // exactly like a task that does not exist.
    expect(await getTaskForUser(t, String(restrictedTask))).toBeNull();
    expect(
      await getTaskForUser(t, String(restrictedTask), { userId: OUTSIDER }),
    ).toBeNull();
    // A user with no membership at all fails closed.
    expect(
      await getTaskForUser(t, String(visibleTask), { userId: 'u_stranger' }),
    ).toBeNull();
  });
});

describe('startTaskWorkflowRun (the seam the start endpoint rides)', () => {
  it('answers null for an undeployed slug — the handler maps it to not_started', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId);

    const started = await t.mutation(
      internal.automations.mutations.startTaskWorkflowRun,
      {
        organizationId: ORG,
        name: 'ghost/desk',
        taskId: String(taskId),
        projectId,
        startedBy: `api-key:${EDITOR}`,
        input: { task: { id: String(taskId) } },
      },
    );
    expect(started).toBeNull();
  });

  it('answers the in-flight run with alreadyRunning instead of racing a duplicate', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId);
    const liveRunId = await t.run((ctx) =>
      ctx.db.insert('automationRuns', {
        organizationId: ORG,
        name: 'vat/desk',
        version: 1,
        projectId,
        status: 'running',
        mode: 'live',
        startedBy: `user:${EDITOR}`,
        input: { task: { id: String(taskId) } },
        startedAt: 0,
      }),
    );

    const started = await t.mutation(
      internal.automations.mutations.startTaskWorkflowRun,
      {
        organizationId: ORG,
        name: 'vat/desk',
        taskId: String(taskId),
        projectId,
        startedBy: `api-key:${EDITOR}`,
        input: { task: { id: String(taskId) } },
      },
    );
    expect(started).toEqual({ runId: liveRunId, alreadyRunning: true });
  });
});

describe('addTaskCommentForUser (shared core with the session addTaskComment)', () => {
  it('lands a USER-authored comment attributed to the key user', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId);

    const result = await t.mutation(
      internal.tasks.mutations.addTaskCommentForUser,
      {
        organizationId: ORG,
        userId: EDITOR,
        userEmail: 'editor@door.test',
        taskId: String(taskId),
        body: 'Ledgers uploaded, ready for the desk.',
      },
    );
    expect(result.messageId).toBeTruthy();
    expect(result.threadId).toBeTruthy();

    const meta = await t.run((ctx) =>
      ctx.db
        .query('taskDiscussionMessageMeta')
        .withIndex('by_messageId', (q) => q.eq('messageId', result.messageId))
        .first(),
    );
    expect(meta).toMatchObject({
      organizationId: ORG,
      taskId,
      threadId: result.threadId,
      authorType: 'user',
      authorId: EDITOR,
    });

    const { task, activity } = await t.run(async (ctx) => ({
      task: await ctx.db.get(taskId),
      activity: await ctx.db
        .query('taskActivity')
        .withIndex('by_task', (q) => q.eq('taskId', taskId))
        .collect(),
    }));
    expect(task?.commentCount).toBe(1);
    expect(activity).toContainEqual(
      expect.objectContaining({
        actorType: 'user',
        actorId: EDITOR,
        action: 'comment.added',
      }),
    );
  });

  it('enforces the READ gate: an org member outside the project team gets the opaque code', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    await seedMember(t, OUTSIDER, ORG, 'member');
    const restrictedProject = await seedProject(t, {
      name: 'Team-only',
      teamId: 'team_hidden',
    });
    const taskId = await seedTask(t, restrictedProject);

    await expectCode(
      t.mutation(internal.tasks.mutations.addTaskCommentForUser, {
        organizationId: ORG,
        userId: OUTSIDER,
        taskId: String(taskId),
        body: 'sneaky',
      }),
      'TASK_NOT_FOUND',
    );
    const metaRows = await t.run((ctx) =>
      ctx.db.query('taskDiscussionMessageMeta').collect(),
    );
    expect(metaRows).toEqual([]);
  });

  it('collapses cross-org ids, garbage ids, and non-members into the same opaque code', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    await seedMember(t, EDITOR, OTHER_ORG, 'editor');
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId);

    const comment = (overrides: Record<string, unknown>) =>
      t.mutation(internal.tasks.mutations.addTaskCommentForUser, {
        organizationId: ORG,
        userId: EDITOR,
        taskId: String(taskId),
        body: 'hello',
        ...overrides,
      });

    await expectCode(comment({ organizationId: OTHER_ORG }), 'TASK_NOT_FOUND');
    await expectCode(comment({ taskId: 'not-a-task-id' }), 'TASK_NOT_FOUND');
    await expectCode(comment({ userId: 'u_stranger' }), 'TASK_NOT_FOUND');
  });

  it('keeps the session body validation (blank after trim refused by the core)', async () => {
    const t = makeT();
    await seedMember(t, EDITOR, ORG, 'editor');
    const projectId = await seedProject(t);
    const taskId = await seedTask(t, projectId);

    await expectCode(
      t.mutation(internal.tasks.mutations.addTaskCommentForUser, {
        organizationId: ORG,
        userId: EDITOR,
        taskId: String(taskId),
        body: '   ',
      }),
      'TASK_COMMENT_INVALID',
    );
  });
});
