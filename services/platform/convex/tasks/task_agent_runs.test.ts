// Coverage for the task-agent run doors — `startTaskAgentRun` and
// `cancelTaskAgentRun` run against a real convex-test backend (schema +
// modules), locking the guard matrix (agent ownership, instance existence,
// model requirement, single live run), the kick's effects (queued
// `projectAgentRuns` row + the card's move to in_progress as the caller's own
// status write), and cancel's terminal stamp. The node host it schedules is
// out of scope here (it cannot run under convex-test) — the live-run E2E
// covers that lane.

import agentComponent from '@convex-dev/agent/test';
import rateLimiterComponent from '@convex-dev/rate-limiter/test';
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

const ORG = 'org_runs';
const EDITOR = 'u_editor';

type T = TestConvex<typeof schema>;

async function seedWorld(
  t: T,
  options: { agentModel?: string | undefined } = { agentModel: 'z-ai/glm-5' },
): Promise<{
  projectId: Id<'projects'>;
  agentId: Id<'projectAgents'>;
  taskId: Id<'tasks'>;
}> {
  return t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${EDITOR}_${ORG}`,
      userId: EDITOR,
      organizationId: ORG,
      role: 'editor',
      createdAt: 0,
    });
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'Apollo',
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
    });
    const agentId = await ctx.db.insert('projectAgents', {
      organizationId: ORG,
      projectId,
      name: 'PR Reviewer',
      harness: 'claude-code',
      ...(options.agentModel !== undefined
        ? { model: options.agentModel }
        : {}),
      skills: [],
      connectors: [],
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
    });
    const taskId = await ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Review the PR',
      status: 'todo',
      rank: 'a0',
      assigneeType: 'agent',
      assigneeId: agentId,
      createdBy: EDITOR,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    });
    return { projectId, agentId, taskId };
  });
}

describe('startTaskAgentRun', () => {
  it('inserts a queued run and moves the card to in_progress', async () => {
    const t = convexTest(schema, modules);
    const { taskId, agentId } = await seedWorld(t);

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    expect(result).toEqual({ started: true });

    const { runs, task } = await t.run(async (ctx) => ({
      runs: await ctx.db.query('projectAgentRuns').collect(),
      task: await ctx.db.get(taskId),
    }));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      taskId,
      agentId,
      status: 'queued',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      startedBy: EDITOR,
    });
    expect(runs[0]?.sessionId).toMatch(/^pa-/);
    expect(task?.status).toBe('in_progress');
  });

  it('refuses a second run while one is live', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    const asEditor = t.withIdentity({ subject: EDITOR });

    await asEditor.mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    const second = await asEditor.mutation(
      api.tasks.mutations.startTaskAgentRun,
      { taskId },
    );
    expect(second).toEqual({ started: false, reason: 'already_running' });
    const runs = await t.run((ctx) =>
      ctx.db.query('projectAgentRuns').collect(),
    );
    expect(runs).toHaveLength(1);
  });

  it('refuses when the task is not agent-owned', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, {
        assigneeType: undefined,
        assigneeId: undefined,
      });
    });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    expect(result).toEqual({ started: false, reason: 'not_agent_owned' });
  });

  it('refuses an instance without a model (pre-model row)', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t, { agentModel: undefined });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    expect(result).toEqual({ started: false, reason: 'agent_model_missing' });
  });

  it('refuses an assignee id that names no live instance', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(taskId, { assigneeId: 'legacy-slug' });
    });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    expect(result).toEqual({ started: false, reason: 'agent_missing' });
  });
});

describe('cancelTaskAgentRun', () => {
  it('stamps the live run cancelled and leaves the task alone', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);
    const asEditor = t.withIdentity({ subject: EDITOR });

    await asEditor.mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    await asEditor.mutation(api.tasks.mutations.cancelTaskAgentRun, { taskId });

    const { runs, task } = await t.run(async (ctx) => ({
      runs: await ctx.db.query('projectAgentRuns').collect(),
      task: await ctx.db.get(taskId),
    }));
    expect(runs[0]?.status).toBe('cancelled');
    expect(runs[0]?.settledAt).toBeDefined();
    expect(task?.status).toBe('in_progress');
  });

  it('is a no-op without a live run', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.cancelTaskAgentRun, { taskId });
    const runs = await t.run((ctx) =>
      ctx.db.query('projectAgentRuns').collect(),
    );
    expect(runs).toHaveLength(0);
  });
});

describe('listStalledTaskAgentTurns', () => {
  const STALE_BEFORE = 10_000;

  /** Start a run through the real door, then shape its liveness signals. */
  async function seedRun(t: T) {
    const { taskId, agentId } = await seedWorld(t);
    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    const run = await t.run(async (ctx) => {
      const rows = await ctx.db.query('projectAgentRuns').collect();
      return rows[0];
    });
    if (!run) throw new Error('run row missing');
    return { taskId, agentId, run };
  }

  const stalled = async (t: T) =>
    await t.query(internal.tasks.agent_runs.listStalledTaskAgentTurns, {
      staleBeforeMs: STALE_BEFORE,
      limit: 10,
    });

  it('lists a run whose start never wrote an op row, once past the window', async () => {
    const t = convexTest(schema, modules);
    const { taskId, run } = await seedRun(t);
    // The scheduled start died before its op upsert; the run row is the
    // durable proof the turn exists. Age it past the staleness window.
    await t.run(async (ctx) => {
      await ctx.db.patch(run._id, { startedAt: STALE_BEFORE - 1 });
    });

    const listed = await stalled(t);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      runId: run._id,
      taskId,
      execId: run.execId,
      sessionId: run.sessionId,
      harness: 'claude-code',
    });
  });

  it('gives a just-scheduled start its window before calling it dead', async () => {
    const t = convexTest(schema, modules);
    await seedRun(t); // startedAt = now, well inside the window
    expect(await stalled(t)).toHaveLength(0);
  });

  it('lists a running turn whose drainer went silent, and only that one', async () => {
    const t = convexTest(schema, modules);
    const { run } = await seedRun(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(run._id, { status: 'running' });
      await ctx.db.insert('sandboxSessionOps', {
        organizationId: ORG,
        sessionId: run.sessionId,
        execId: run.execId,
        kind: 'task-agent',
        status: 'running',
        startedAt: STALE_BEFORE - 1,
        heartbeatAt: STALE_BEFORE - 1,
      });
    });
    expect(await stalled(t)).toHaveLength(1);

    // A live drainer bumped the heartbeat → not abandoned.
    await t.run(async (ctx) => {
      const op = await ctx.db.query('sandboxSessionOps').first();
      if (op) await ctx.db.patch(op._id, { heartbeatAt: Date.now() });
    });
    expect(await stalled(t)).toHaveLength(0);
  });

  it('skips settled ops and terminal runs — those are the host’s to finish', async () => {
    const t = convexTest(schema, modules);
    const { run } = await seedRun(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(run._id, { status: 'running' });
      await ctx.db.insert('sandboxSessionOps', {
        organizationId: ORG,
        sessionId: run.sessionId,
        execId: run.execId,
        kind: 'task-agent',
        status: 'completed',
        startedAt: STALE_BEFORE - 1,
        heartbeatAt: STALE_BEFORE - 1,
      });
    });
    expect(await stalled(t)).toHaveLength(0);

    await t.run(async (ctx) => {
      await ctx.db.patch(run._id, { status: 'settled', startedAt: 0 });
    });
    expect(await stalled(t)).toHaveLength(0);
  });
});

// The comment @mention work trigger: @-ing a project agent INSTANCE by its
// display name (re)assigns the task and kicks a run that carries the comment
// as feedback. Comment posting needs the rate-limiter and agent (discussion
// store) components the mutation rides on.
describe('comment @mention trigger', () => {
  function world(): T {
    const t = convexTest(schema, modules);
    rateLimiterComponent.register(t);
    agentComponent.register(t);
    return t;
  }

  async function runs(t: T) {
    return await t.run((ctx) => ctx.db.query('projectAgentRuns').collect());
  }

  it('kicks a run carrying the comment as feedback (dot handle)', async () => {
    const t = world();
    const { taskId, agentId } = await seedWorld(t);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: '@pr.reviewer 第3页的图请换成真实照片',
      });

    const rows = await runs(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agentId,
      trigger: 'mention',
      feedback: '@pr.reviewer 第3页的图请换成真实照片',
    });
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe('in_progress');
  });

  it('reassigns to a different mentioned agent, then kicks it', async () => {
    const t = world();
    const { taskId, projectId } = await seedWorld(t);
    const bobId = await t.run((ctx) =>
      ctx.db.insert('projectAgents', {
        organizationId: ORG,
        projectId,
        name: 'Bob',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        skills: [],
        connectors: [],
        createdBy: EDITOR,
        createdAt: 0,
        updatedAt: 0,
      }),
    );

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: '@bob take this over',
      });

    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.assigneeType).toBe('agent');
    expect(task?.assigneeId).toBe(String(bobId));
    const rows = await runs(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ agentId: bobId, trigger: 'mention' });
  });

  it('changes nothing while a run is live', async () => {
    const t = world();
    const { taskId, agentId } = await seedWorld(t);
    const asEditor = t.withIdentity({ subject: EDITOR });
    await asEditor.mutation(api.tasks.mutations.startTaskAgentRun, { taskId });

    await asEditor.mutation(api.tasks.mutations.addTaskComment, {
      taskId,
      body: '@pr.reviewer hurry up',
    });

    const rows = await runs(t);
    expect(rows).toHaveLength(1); // still only the manual run
    expect(rows[0]).toMatchObject({ agentId, trigger: 'manual' });
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.assigneeId).toBe(String(agentId));
  });

  it("a read-only member's mention only comments", async () => {
    const t = world();
    const { taskId } = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('memberMirror', {
        memberId: `m_u_viewer_${ORG}`,
        userId: 'u_viewer',
        organizationId: ORG,
        role: 'member',
        createdAt: 0,
      });
    });

    await t
      .withIdentity({ subject: 'u_viewer' })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: '@pr.reviewer please rerun',
      });

    expect(await runs(t)).toHaveLength(0);
  });

  it('the directory resolves an instance by name variants AND raw id', async () => {
    // A REAL Convex id fits the mention charset, so a picker-inserted or
    // copied id token must resolve even under agentMode 'restricted' (no
    // permissive fallback). convex-test ids carry a ';' the parser rejects,
    // so this locks the DIRECTORY contract rather than the full comment path.
    const t = world();
    const { projectId, agentId } = await seedWorld(t);

    const entry = await t.run(async (ctx) => {
      const project = await ctx.db.get(projectId);
      if (!project) throw new Error('project missing');
      const { buildMentionDirectory } = await import('./directory');
      const directory = await buildMentionDirectory(ctx, {
        organizationId: ORG,
        project,
      });
      return directory.entries.find((e) => e.id === String(agentId));
    });
    expect(entry).toBeDefined();
    expect(entry?.handles).toContain('pr.reviewer');
    expect(entry?.handles).toContain('prreviewer');
    expect(entry?.handles).toContain(String(agentId).toLowerCase());
  });

  it('a comment without an agent mention never kicks', async () => {
    const t = world();
    const { taskId } = await seedWorld(t);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: 'looks good, minor nits only',
      });

    expect(await runs(t)).toHaveLength(0);
  });
});

// The capacity-parking lane: a start that lost the slot reserve parks the run
// (still `queued`), the claim is single-winner, the release-edge wake
// restarts the OLDEST parked run with the agent's CURRENT equipment, and the
// stalled-turn reaper leaves parked runs alone (it used to manufacture an op
// row and kill them with a wrong reason — observed live).
describe('capacity parking', () => {
  async function seedParkedRun(
    t: T,
    overrides: { waitingForCapacityAt?: number; startedAt?: number } = {},
  ) {
    const { taskId, agentId, projectId } = await seedWorld(t);
    const runId = await t.run(async (ctx) =>
      ctx.db.insert('projectAgentRuns', {
        organizationId: ORG,
        projectId,
        taskId,
        agentId,
        execId: `exec-${overrides.startedAt ?? 1}`,
        sessionId: 'pa-x',
        status: 'queued',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        waitingForCapacityAt: overrides.waitingForCapacityAt ?? 5,
        startedBy: EDITOR,
        startedAt: overrides.startedAt ?? 1,
        deadlineAt: Date.now() + 60_000,
        updatedAt: 1,
      }),
    );
    return { runId, taskId, agentId, projectId };
  }

  it('parks only a queued run under its own execId', async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seedParkedRun(t, { waitingForCapacityAt: 5 });
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { waitingForCapacityAt: undefined });
    });

    await t.mutation(internal.tasks.agent_runs.parkTaskAgentRunForCapacity, {
      runId,
      execId: 'exec-1',
    });
    let run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.waitingForCapacityAt).toBeDefined();

    // A stale exec (rerun reused the row) must not re-park the new turn.
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, {
        waitingForCapacityAt: undefined,
        execId: 'exec-2',
      });
    });
    await t.mutation(internal.tasks.agent_runs.parkTaskAgentRunForCapacity, {
      runId,
      execId: 'exec-1',
    });
    run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.waitingForCapacityAt).toBeUndefined();
  });

  it('claims a parked run exactly once', async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seedParkedRun(t);

    const first = await t.mutation(
      internal.tasks.agent_runs.claimParkedTaskAgentRun,
      { runId, execId: 'exec-1' },
    );
    const second = await t.mutation(
      internal.tasks.agent_runs.claimParkedTaskAgentRun,
      { runId, execId: 'exec-1' },
    );
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('the wake restarts the oldest parked run and re-reads the agent row', async () => {
    const t = convexTest(schema, modules);
    const { runId: newerRun, agentId } = await seedParkedRun(t, {
      startedAt: 100,
    });
    // A second, OLDER parked run of the same agent on another task.
    const { taskId: taskB, runId: olderRun } = await t.run(async (ctx) => {
      const newer = await ctx.db.get(newerRun);
      if (!newer) throw new Error('seed lost');
      const taskId = await ctx.db.insert('tasks', {
        organizationId: ORG,
        projectId: newer.projectId,
        title: 'Older task',
        status: 'in_progress',
        rank: 'a1',
        assigneeType: 'agent',
        assigneeId: newer.agentId,
        createdBy: EDITOR,
        createdByType: 'user',
        createdAt: 0,
        updatedAt: 0,
      });
      const runId = await ctx.db.insert('projectAgentRuns', {
        organizationId: ORG,
        projectId: newer.projectId,
        taskId,
        agentId: newer.agentId,
        execId: 'exec-old',
        sessionId: 'pa-x',
        status: 'queued',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        waitingForCapacityAt: 6,
        startedBy: EDITOR,
        startedAt: 10,
        deadlineAt: Date.now() + 60_000,
        updatedAt: 10,
      });
      return { taskId, runId };
    });
    // Equipment edited while parked — the restart must carry the CURRENT set.
    await t.run(async (ctx) => {
      await ctx.db.patch(agentId, { skills: ['fresh-skill'] });
    });

    await t.mutation(internal.tasks.agent_runs.wakeParkedTaskAgentRuns, {
      organizationId: ORG,
    });

    const [older, newer, scheduled] = await t.run(async (ctx) => [
      await ctx.db.get(olderRun),
      await ctx.db.get(newerRun),
      await ctx.db.system.query('_scheduled_functions').collect(),
    ]);
    // Oldest claimed (stamp cleared), newer still parked.
    expect(older?.waitingForCapacityAt).toBeUndefined();
    expect(newer?.waitingForCapacityAt).toBeDefined();
    const starts = scheduled.filter((job) =>
      job.name.includes('startTaskAgentTurn'),
    );
    expect(starts).toHaveLength(1);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- system table args are untyped
    const startArgs = starts[0]?.args[0] as {
      runId: string;
      taskId: string;
      skills: string[];
    };
    expect(startArgs.runId).toBe(olderRun);
    expect(startArgs.taskId).toBe(taskB);
    expect(startArgs.skills).toEqual(['fresh-skill']);
  });

  it('the wake fails a parked run whose agent was deleted, with the real reason', async () => {
    const t = convexTest(schema, modules);
    const { runId, agentId } = await seedParkedRun(t);
    await t.run(async (ctx) => {
      await ctx.db.delete(agentId);
    });

    await t.mutation(internal.tasks.agent_runs.wakeParkedTaskAgentRuns, {
      organizationId: ORG,
    });

    const run = await t.run((ctx) => ctx.db.get(runId));
    expect(run?.status).toBe('failed');
    expect(run?.error).toContain('deleted while the run waited');
  });

  it('the stalled-turn list leaves parked runs alone', async () => {
    const t = convexTest(schema, modules);
    await seedParkedRun(t, { startedAt: 1 });

    const stalled = await t.query(
      internal.tasks.agent_runs.listStalledTaskAgentTurns,
      { staleBeforeMs: Date.now(), limit: 10 },
    );
    expect(stalled).toHaveLength(0);

    const parked = await t.query(
      internal.tasks.agent_runs.listParkedTaskAgentRuns,
      { limit: 10 },
    );
    expect(parked).toHaveLength(1);
  });
});
