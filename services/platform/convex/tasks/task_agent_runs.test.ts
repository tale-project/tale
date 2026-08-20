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
import { sessionIdForProjectAgent } from '../sandbox/session_naming';
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
    // durable proof the turn exists. Age it past the staleness window —
    // `updatedAt` too: the no-op-row grace honors the LATEST of the two, so
    // a wake of a long-parked run (claim bumps `updatedAt`) gets its window.
    await t.run(async (ctx) => {
      await ctx.db.patch(run._id, {
        startedAt: STALE_BEFORE - 1,
        updatedAt: STALE_BEFORE - 1,
      });
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

  it('spares a fresh settle, lists a dead one, skips terminal runs', async () => {
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
        finalizedAt: Date.now(),
        finishedAt: Date.now(),
      });
    });
    // Settle lease fresh: its winner is still doing the run-side work
    // (harvest, report, markSettled) — the host's to finish, not ours.
    expect(await stalled(t)).toHaveLength(0);

    // Lease silent past the staleness window with the run never settled:
    // the settle died mid-flight — list it for re-attach.
    await t.run(async (ctx) => {
      const op = await ctx.db.query('sandboxSessionOps').first();
      if (op) {
        await ctx.db.patch(op._id, {
          finalizedAt: STALE_BEFORE - 1,
          finishedAt: STALE_BEFORE - 1,
        });
      }
    });
    expect(await stalled(t)).toHaveLength(1);

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

describe('getTaskBriefForAgentRun', () => {
  function world(): T {
    const t = convexTest(schema, modules);
    rateLimiterComponent.register(t);
    agentComponent.register(t);
    return t;
  }

  it('carries the discussion tail and the input blob refs alongside the task fields', async () => {
    const t = world();
    const { taskId } = await seedWorld(t);
    const asEditor = t.withIdentity({ subject: EDITOR });

    // A mention-free comment (never kicks) followed by an agent report — the
    // exchange a rerun must see to know what was already delivered.
    await asEditor.mutation(api.tasks.mutations.addTaskComment, {
      taskId,
      body: '请对齐字体',
    });
    await t.mutation(internal.tasks.internal_mutations.agentAddComment, {
      organizationId: ORG,
      actorId: 'agent_alice',
      taskId,
      body: 'Done — delivered deck.pptx with 20 slides.',
    });

    // A prior run's harvested deliverable plus a user attachment on the task.
    await asEditor.mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    await t.run(async (ctx) => {
      const run = await ctx.db.query('projectAgentRuns').first();
      if (run === null) throw new Error('seed run missing');
      await ctx.db.patch(taskId, {
        attachments: [
          {
            fileId: 'blob-spec',
            fileName: 'spec.pdf',
            fileType: 'application/pdf',
            fileSize: 10,
          },
        ],
        outputs: [
          {
            fileId: 'blob-deck',
            fileName: 'deck.pptx',
            fileType: 'application/vnd.ms-powerpoint',
            fileSize: 20,
            producedAt: 1,
            runId: run._id,
          },
        ],
      });
    });

    const brief = await t.query(
      internal.tasks.agent_runs.getTaskBriefForAgentRun,
      { taskId },
    );
    expect(brief?.discussion).toEqual([
      { author: 'user', body: '请对齐字体', at: expect.any(Number) },
      {
        author: 'agent',
        body: 'Done — delivered deck.pptx with 20 slides.',
        at: expect.any(Number),
      },
    ]);
    expect(brief?.attachments).toEqual([
      { fileId: 'blob-spec', fileName: 'spec.pdf' },
    ]);
    expect(brief?.outputs).toEqual([
      { fileId: 'blob-deck', fileName: 'deck.pptx' },
    ]);
  });

  it('clips an oversize comment body instead of flooding the prompt', async () => {
    const t = world();
    const { taskId } = await seedWorld(t);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: 'x'.repeat(2500),
      });

    const brief = await t.query(
      internal.tasks.agent_runs.getTaskBriefForAgentRun,
      { taskId },
    );
    expect(brief?.discussion).toHaveLength(1);
    expect(brief?.discussion[0]?.body.endsWith('… (truncated)')).toBe(true);
    expect(brief?.discussion[0]?.body.length).toBeLessThan(2100);
  });

  it('a task with no discussion, attachments, or outputs yields empty lists', async () => {
    const t = world();
    const { taskId } = await seedWorld(t);

    const brief = await t.query(
      internal.tasks.agent_runs.getTaskBriefForAgentRun,
      { taskId },
    );
    expect(brief?.discussion).toEqual([]);
    expect(brief?.attachments).toEqual([]);
    expect(brief?.outputs).toEqual([]);
  });
});

// Mid-run comment steering: a mention of the RUNNING agent no longer drops —
// the door schedules `steerTaskAgentTurn` against the live exec. The pure
// lane/text halves live in agent_run_steer.test.ts; here the convex-test
// halves: the door's branches, the exec rotation's single-winner claim, the
// exec-guarded terminal marks, and the steer-miss fallback kick.
describe('mid-run comment steering', () => {
  function world(): T {
    const t = convexTest(schema, modules);
    rateLimiterComponent.register(t);
    agentComponent.register(t);
    return t;
  }

  const runRows = (t: T) =>
    t.run((ctx) => ctx.db.query('projectAgentRuns').collect());

  const steerJobs = (t: T) =>
    t.run(async (ctx) =>
      (await ctx.db.system.query('_scheduled_functions').collect()).filter(
        (job) => job.name.includes('steerTaskAgentTurn'),
      ),
    );

  async function seedRunningRun(t: T) {
    const { taskId, agentId, projectId } = await seedWorld(t);
    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    const run = (await runRows(t))[0];
    if (!run) throw new Error('run row missing');
    await t.run(async (ctx) => {
      await ctx.db.patch(run._id, { status: 'running' });
    });
    return { taskId, agentId, projectId, run };
  }

  it('a mention of the RUNNING agent schedules a steer instead of dropping', async () => {
    const t = world();
    const { taskId, run } = await seedRunningRun(t);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.addTaskComment, {
        taskId,
        body: '@pr.reviewer 空白页太多了',
      });

    expect(await runRows(t)).toHaveLength(1); // no second engine
    const jobs = await steerJobs(t);
    expect(jobs).toHaveLength(1);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- system table args are untyped
    const args = jobs[0]?.args[0] as {
      execId: string;
      feedback: string;
      author: string;
      attempt: number;
      model: string;
      skills: string[];
    };
    expect(args.execId).toBe(run.execId);
    expect(args.feedback).toBe('@pr.reviewer 空白页太多了');
    // Test user ids resolve to no Better Auth user — the label falls back.
    expect(args.author).toBe('a teammate');
    expect(args.attempt).toBe(0);
    expect(args.model).toBe('z-ai/glm-5');
    expect(args.skills).toEqual([]);
  });

  it('a queued run is left alone — its start reads the brief after the comment', async () => {
    const t = world();
    const { taskId } = await seedWorld(t);
    const asEditor = t.withIdentity({ subject: EDITOR });
    await asEditor.mutation(api.tasks.mutations.startTaskAgentRun, { taskId });

    await asEditor.mutation(api.tasks.mutations.addTaskComment, {
      taskId,
      body: '@pr.reviewer also add a summary page',
    });

    expect(await steerJobs(t)).toHaveLength(0);
    expect(await runRows(t)).toHaveLength(1);
  });

  it('a mention of a DIFFERENT agent never preempts the live engine', async () => {
    const t = world();
    const { taskId, agentId, projectId } = await seedRunningRun(t);
    await t.run((ctx) =>
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

    expect(await steerJobs(t)).toHaveLength(0);
    expect(await runRows(t)).toHaveLength(1);
    const task = await t.run((ctx) => ctx.db.get(taskId));
    expect(task?.assigneeId).toBe(String(agentId)); // no reassign under a live engine
  });

  it('rotateTaskAgentRunExec swaps the exec exactly once (single-winner)', async () => {
    const t = world();
    const { run } = await seedRunningRun(t);

    const rotated = await t.mutation(
      internal.tasks.agent_runs.rotateTaskAgentRunExec,
      { runId: run._id, fromExecId: run.execId },
    );
    expect(rotated).toEqual({ execId: `${run.execId}-2` });
    const fresh = await t.run((ctx) => ctx.db.get(run._id));
    expect(fresh?.execId).toBe(`${run.execId}-2`);

    // A raced second steer still holding the OLD exec loses the claim.
    const again = await t.mutation(
      internal.tasks.agent_runs.rotateTaskAgentRunExec,
      { runId: run._id, fromExecId: run.execId },
    );
    expect(again).toBeNull();

    // A terminal run can never rotate.
    await t.run(async (ctx) => {
      await ctx.db.patch(run._id, { status: 'settled', settledAt: 1 });
    });
    expect(
      await t.mutation(internal.tasks.agent_runs.rotateTaskAgentRunExec, {
        runId: run._id,
        fromExecId: `${run.execId}-2`,
      }),
    ).toBeNull();
  });

  it('the terminal marks are exec-guarded against a superseded chain', async () => {
    const t = world();
    const { run } = await seedRunningRun(t);
    await t.mutation(internal.tasks.agent_runs.rotateTaskAgentRunExec, {
      runId: run._id,
      fromExecId: run.execId,
    });

    // The killed chain settles on its own path — its mark must be a no-op.
    await t.mutation(internal.tasks.agent_runs.markTaskAgentRunFailed, {
      runId: run._id,
      error: 'the harness exited unexpectedly',
      execId: run.execId,
    });
    let fresh = await t.run((ctx) => ctx.db.get(run._id));
    expect(fresh?.status).toBe('running');
    expect(fresh?.error).toBeUndefined();

    // The incarnation's own settle lands.
    await t.mutation(internal.tasks.agent_runs.markTaskAgentRunSettled, {
      runId: run._id,
      resultText: 'done',
      execId: `${run.execId}-2`,
    });
    fresh = await t.run((ctx) => ctx.db.get(run._id));
    expect(fresh?.status).toBe('settled');
  });

  it('the steer-miss fallback kicks a fresh mention run once the engine settled', async () => {
    const t = world();
    const { taskId, run } = await seedRunningRun(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(run._id, { status: 'settled', settledAt: 1 });
    });

    await t.mutation(internal.tasks.mutations.kickMentionRunAfterSteerMiss, {
      taskId,
      authorId: EDITOR,
      feedback: 'also add a summary page',
    });

    const rows = await runRows(t);
    expect(rows).toHaveLength(2);
    const kicked = rows.find((row) => row.status === 'queued');
    expect(kicked).toMatchObject({
      trigger: 'mention',
      feedback: 'also add a summary page',
      startedBy: EDITOR,
    });
  });

  it('the steer-miss fallback refuses while an engine is still live', async () => {
    const t = world();
    const { taskId } = await seedRunningRun(t);

    await t.mutation(internal.tasks.mutations.kickMentionRunAfterSteerMiss, {
      taskId,
      authorId: EDITOR,
      feedback: 'late comment',
    });

    expect(await runRows(t)).toHaveLength(1); // already_running → refused
  });
});

// Kick-time resume: a later kick of the same task CONTINUES the
// predecessor's harness conversation. The decision table is pure-tested in
// task_kick_resume.test.ts; these lock what the two schedulers (kick, wake)
// actually carry into the scheduled start — the only contract the node host
// consumes.
describe('kick-time resume', () => {
  const HANDLE = 'c2a38047-3e04-4874-b87a-6a38f56d5041';

  async function scheduledStartArgs(t: T) {
    const scheduled = await t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const starts = scheduled.filter((job) =>
      job.name.includes('startTaskAgentTurn'),
    );
    expect(starts).toHaveLength(1);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- system table args are untyped
    return starts[0]?.args[0] as {
      resume?: string;
      resumeSessionCreatedAt?: number;
      resumeDiscussionSince?: number;
      resumePredecessorExecId?: string;
      sweep?: boolean;
      inspectNote?: boolean;
    };
  }

  /** The agent's standing-session row plus a terminal predecessor run that
   * actually launched — the world a Retry resumes into. `stampRun: false`
   * seeds a pre-feature row (handle only on its session op). */
  async function seedResumableWorld(
    t: T,
    options: {
      runStatus?: 'settled' | 'failed';
      stampRun?: boolean;
      liveCreatedAt?: number;
    } = {},
  ) {
    const { taskId, agentId, projectId } = await seedWorld(t);
    const sessionId = sessionIdForProjectAgent(agentId);
    const stampedCreatedAt = 111;
    await t.run(async (ctx) => {
      await ctx.db.insert('sandboxSessions', {
        organizationId: ORG,
        sessionId,
        profile: 'agent',
        status: 'stopped',
        ownerType: 'project_agent',
        ownerId: String(agentId),
        createdBy: 'system:task-agent',
        createdAt: options.liveCreatedAt ?? stampedCreatedAt,
        expiresAt: Date.now() + 60_000,
      });
      await ctx.db.insert('projectAgentRuns', {
        organizationId: ORG,
        projectId,
        taskId,
        agentId,
        execId: 'exec-prev',
        sessionId,
        status: options.runStatus ?? 'failed',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        ...(options.stampRun === false
          ? {}
          : { agentSessionId: HANDLE, sessionCreatedAt: stampedCreatedAt }),
        startedBy: EDITOR,
        startedAt: 1_000,
        deadlineAt: 2_000,
        settledAt: 1_500,
        updatedAt: 1_500,
      });
      if (options.stampRun === false) {
        await ctx.db.insert('sandboxSessionOps', {
          organizationId: ORG,
          sessionId,
          execId: 'exec-prev',
          kind: 'task-agent',
          status: 'failed',
          startedAt: 1_000,
          heartbeatAt: 1_000,
          agentSessionId: HANDLE,
        });
      }
    });
    return { taskId, agentId, projectId, sessionId };
  }

  it('Retry after a failed run carries --resume and protects the box', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedResumableWorld(t, { runStatus: 'failed' });

    const result = await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
    expect(result).toEqual({ started: true });

    // A NEW queued row is still minted — terminal rows stay terminal.
    const rows = await t.run((ctx) =>
      ctx.db.query('projectAgentRuns').collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.status).sort()).toEqual(['failed', 'queued']);

    const args = await scheduledStartArgs(t);
    expect(args.resume).toBe(HANDLE);
    expect(args.resumeSessionCreatedAt).toBe(111);
    expect(args.resumeDiscussionSince).toBe(1_000);
    // The predecessor's exec rides along so the start can reap a
    // still-dying incarnation before forking its conversation.
    expect(args.resumePredecessorExecId).toBe('exec-prev');
    expect(args.sweep).toBe(false); // the box may hold the only copy
    expect(args.inspectNote).toBe(true);
  });

  it('a settled predecessor resumes AND sweeps its harvested leftovers', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedResumableWorld(t, { runStatus: 'settled' });

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });

    const args = await scheduledStartArgs(t);
    expect(args.resume).toBe(HANDLE);
    expect(args.sweep).toBe(true); // leftovers already on task.outputs
    expect(args.inspectNote).toBe(false);
  });

  it('the first start omits resume and sweeps (no predecessor)', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedWorld(t);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });

    const args = await scheduledStartArgs(t);
    expect(args.resume).toBeUndefined();
    expect(args.sweep).toBe(true);
    expect(args.inspectNote).toBe(false);
  });

  it("a pre-stamp predecessor's handle is recovered from its own session op", async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedResumableWorld(t, { stampRun: false });

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });

    const args = await scheduledStartArgs(t);
    expect(args.resume).toBe(HANDLE);
    // No stamp on an op-recovered handle — the start's re-check binds it
    // through the predecessor-settle bound instead.
    expect(args.resumeSessionCreatedAt).toBe(111);
    expect(args.resumeDiscussionSince).toBe(1_000);
  });

  it('a destroyed-and-recreated session never gets the old handle', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedResumableWorld(t, {
      runStatus: 'failed',
      liveCreatedAt: 9_999, // recreated AFTER the stamp's incarnation
    });

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });

    const args = await scheduledStartArgs(t);
    expect(args.resume).toBeUndefined();
    expect(args.sweep).toBe(false); // fresh per the failed predecessor
    expect(args.inspectNote).toBe(true);
  });

  it('the wake of a fail-then-parked run carries the predecessor handle', async () => {
    const t = convexTest(schema, modules);
    const { taskId, agentId, projectId, sessionId } = await seedResumableWorld(
      t,
      { runStatus: 'failed' },
    );
    // The Retry parked on capacity before its start could run — the wake
    // must re-decide on the PREDECESSOR, not drop the resume.
    await t.run(async (ctx) => {
      await ctx.db.insert('projectAgentRuns', {
        organizationId: ORG,
        projectId,
        taskId,
        agentId,
        execId: 'exec-parked',
        sessionId,
        status: 'queued',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        waitingForCapacityAt: 2_000,
        startedBy: EDITOR,
        startedAt: 2_000,
        deadlineAt: Date.now() + 60_000,
        updatedAt: 2_000,
      });
    });

    await t.mutation(internal.tasks.agent_runs.wakeParkedTaskAgentRuns, {
      organizationId: ORG,
    });

    const args = await scheduledStartArgs(t);
    expect(args.resume).toBe(HANDLE);
    expect(args.resumeSessionCreatedAt).toBe(111);
    expect(args.sweep).toBe(false);
  });

  it('the wake of a never-started first run omits resume', async () => {
    const t = convexTest(schema, modules);
    const { taskId, agentId, projectId } = await seedWorld(t);
    await t.run(async (ctx) => {
      await ctx.db.insert('projectAgentRuns', {
        organizationId: ORG,
        projectId,
        taskId,
        agentId,
        execId: 'exec-first',
        sessionId: 'pa-x',
        status: 'queued',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        waitingForCapacityAt: 5,
        startedBy: EDITOR,
        startedAt: 1,
        deadlineAt: Date.now() + 60_000,
        updatedAt: 1,
      });
    });

    await t.mutation(internal.tasks.agent_runs.wakeParkedTaskAgentRuns, {
      organizationId: ORG,
    });

    const args = await scheduledStartArgs(t);
    expect(args.resume).toBeUndefined();
    expect(args.sweep).toBe(true);
  });

  it('a never-launched terminal row is skipped — the walk decides on the run behind it', async () => {
    const t = convexTest(schema, modules);
    const { taskId, agentId, projectId, sessionId } = await seedResumableWorld(
      t,
      { runStatus: 'failed' },
    );
    // A later kick that died before spawning (no handle, no op row) — e.g. a
    // refused model resolution. It says nothing about the box or the
    // conversation and must not mask the resumable run behind it.
    await t.run(async (ctx) => {
      await ctx.db.insert('projectAgentRuns', {
        organizationId: ORG,
        projectId,
        taskId,
        agentId,
        execId: 'exec-neverran',
        sessionId,
        status: 'failed',
        harness: 'claude-code',
        model: 'z-ai/glm-5',
        startedBy: EDITOR,
        startedAt: 3_000,
        deadlineAt: 4_000,
        settledAt: 3_100,
        updatedAt: 3_100,
      });
    });

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });

    const args = await scheduledStartArgs(t);
    expect(args.resume).toBe(HANDLE);
  });

  /** Insert `count` never-launched terminal rows (no handle, no op row). */
  async function seedNeverLaunchedRuns(
    t: T,
    world: {
      taskId: Id<'tasks'>;
      agentId: Id<'projectAgents'>;
      projectId: Id<'projects'>;
      sessionId: string;
    },
    count: number,
  ) {
    await t.run(async (ctx) => {
      for (let i = 0; i < count; i += 1) {
        await ctx.db.insert('projectAgentRuns', {
          organizationId: ORG,
          projectId: world.projectId,
          taskId: world.taskId,
          agentId: world.agentId,
          execId: `exec-neverran-${i}`,
          sessionId: world.sessionId,
          status: 'failed',
          harness: 'claude-code',
          model: 'z-ai/glm-5',
          startedBy: EDITOR,
          startedAt: 3_000 + i,
          deadlineAt: 4_000 + i,
          settledAt: 3_100 + i,
          updatedAt: 3_100 + i,
        });
      }
    });
  }

  it('an EXHAUSTED walk keeps the box instead of masquerading as a first start', async () => {
    const t = convexTest(schema, modules);
    const world = await seedResumableWorld(t, { runStatus: 'failed' });
    // Enough never-launched rows to burn the whole scan budget: the launched
    // failed run (whose box may hold the only copy) sits beyond the horizon.
    await seedNeverLaunchedRuns(t, world, 15);

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, {
        taskId: world.taskId,
      });

    const args = await scheduledStartArgs(t);
    expect(args.resume).toBeUndefined();
    expect(args.sweep).toBe(false); // unknown ≠ first start — keep the box
    expect(args.inspectNote).toBe(true);
  });

  it('a NATURALLY drained walk (nothing ever launched) still sweeps as a first start', async () => {
    const t = convexTest(schema, modules);
    const { taskId, agentId, projectId } = await seedWorld(t);
    await seedNeverLaunchedRuns(
      t,
      { taskId, agentId, projectId, sessionId: 'pa-x' },
      3,
    );

    await t
      .withIdentity({ subject: EDITOR })
      .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });

    const args = await scheduledStartArgs(t);
    expect(args.resume).toBeUndefined();
    expect(args.sweep).toBe(true); // provably nothing in the box
    expect(args.inspectNote).toBe(false);
  });
});
