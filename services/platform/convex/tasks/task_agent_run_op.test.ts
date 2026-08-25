// `getTaskAgentRunSandboxOp` — the read behind the run card's "Details"
// transcript. The agent's STANDING session accumulates one op per run, so the
// query must key to the RUN's own exec (never a sibling run's op), surface
// only the `task-agent` lane, and stay fail-closed for outsiders.

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from '../_generated/api';
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

const ORG = 'org_runop';
const EDITOR = 'u_editor';
const STRANGER = 'u_stranger';

type T = TestConvex<typeof schema>;

/** Seed the world and kick a run through the real door, so the row carries
 * the host's own execId/sessionId shape. */
async function seedRun(t: T): Promise<{
  taskId: Id<'tasks'>;
  run: Doc<'projectAgentRuns'>;
}> {
  const taskId = await t.run(async (ctx) => {
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
      name: 'Alice',
      harness: 'claude-code',
      model: 'z-ai/glm-5',
      skills: [],
      connectors: [],
      createdBy: EDITOR,
      createdAt: 0,
      updatedAt: 0,
    });
    return await ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'Build the deck',
      status: 'todo',
      rank: 'a0',
      assigneeType: 'agent',
      assigneeId: agentId,
      createdBy: EDITOR,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    });
  });
  await t
    .withIdentity({ subject: EDITOR })
    .mutation(api.tasks.mutations.startTaskAgentRun, { taskId });
  const run = await t.run(async (ctx) => {
    const rows = await ctx.db.query('projectAgentRuns').collect();
    return rows[0];
  });
  if (!run) throw new Error('run row missing');
  return { taskId, run };
}

async function seedOp(
  t: T,
  run: Doc<'projectAgentRuns'>,
  overrides: {
    execId?: string;
    kind?: string;
    status?: 'running' | 'completed' | 'failed' | 'cancelled';
    progressText?: string;
    liveTimeline?: { type: string; text?: string }[];
    startedAt?: number;
    modelRef?: string;
  } = {},
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('sandboxSessionOps', {
      organizationId: ORG,
      sessionId: run.sessionId,
      execId: overrides.execId ?? run.execId,
      kind: overrides.kind ?? 'task-agent',
      status: overrides.status ?? 'running',
      startedAt: overrides.startedAt ?? 0,
      ...(overrides.progressText !== undefined && {
        progressText: overrides.progressText,
      }),
      ...(overrides.liveTimeline !== undefined && {
        liveTimeline: overrides.liveTimeline,
      }),
      ...(overrides.modelRef !== undefined && {
        modelRef: overrides.modelRef,
      }),
    });
  });
}

describe('getTaskAgentRunSandboxOp', () => {
  it('returns the run’s own op with its transcript', async () => {
    const t = convexTest(schema, modules);
    const { run } = await seedRun(t);
    await seedOp(t, run, {
      progressText: 'laying out the slides',
      liveTimeline: [{ type: 'tool-Bash', text: undefined }],
    });

    const op = await t
      .withIdentity({ subject: EDITOR })
      .query(api.tasks.queries.getTaskAgentRunSandboxOp, {
        organizationId: ORG,
        runId: run._id,
      });
    expect(op).toMatchObject({
      execId: run.execId,
      status: 'running',
      progressText: 'laying out the slides',
      liveTimeline: [{ type: 'tool-Bash' }],
    });
  });

  it('surfaces the serving the turn ran on', async () => {
    const t = convexTest(schema, modules);
    const { run } = await seedRun(t);
    await seedOp(t, run, { modelRef: 'anthropic/claude-fable-5' });

    const op = await t
      .withIdentity({ subject: EDITOR })
      .query(api.tasks.queries.getTaskAgentRunSandboxOp, {
        organizationId: ORG,
        runId: run._id,
      });
    expect(op?.modelRef).toBe('anthropic/claude-fable-5');
  });

  it('matches a derived exec incarnation of the same run', async () => {
    const t = convexTest(schema, modules);
    const { run } = await seedRun(t);
    await seedOp(t, run, { execId: `${run.execId}-t1`, startedAt: 5 });

    const op = await t
      .withIdentity({ subject: EDITOR })
      .query(api.tasks.queries.getTaskAgentRunSandboxOp, {
        organizationId: ORG,
        runId: run._id,
      });
    expect(op).toMatchObject({ execId: `${run.execId}-t1` });
  });

  it('never surfaces a sibling run’s op from the shared standing session', async () => {
    const t = convexTest(schema, modules);
    const { run } = await seedRun(t);
    // A NEWER op of another run in the same session must not shadow ours.
    await seedOp(t, run, {
      execId: 'run-other-exec',
      progressText: 'someone else’s turn',
      startedAt: 99,
    });
    await seedOp(t, run, { progressText: 'this run’s turn', startedAt: 1 });

    const op = await t
      .withIdentity({ subject: EDITOR })
      .query(api.tasks.queries.getTaskAgentRunSandboxOp, {
        organizationId: ORG,
        runId: run._id,
      });
    expect(op).toMatchObject({
      execId: run.execId,
      progressText: 'this run’s turn',
    });
  });

  it('ignores non-agent ops of the same exec', async () => {
    const t = convexTest(schema, modules);
    const { run } = await seedRun(t);
    await seedOp(t, run, { kind: 'exec', progressText: 'run_code output' });

    const op = await t
      .withIdentity({ subject: EDITOR })
      .query(api.tasks.queries.getTaskAgentRunSandboxOp, {
        organizationId: ORG,
        runId: run._id,
      });
    expect(op).toBeNull();
  });

  it('keeps the resume handle OFF the payload — the op projection is the contract', async () => {
    const t = convexTest(schema, modules);
    const { run, taskId } = await seedRun(t);
    await seedOp(t, run, { progressText: 'working' });
    await t.run(async (ctx) => {
      const op = await ctx.db.query('sandboxSessionOps').first();
      if (op) {
        await ctx.db.patch(op._id, { agentSessionId: 'conv-handle-secret' });
      }
      await ctx.db.patch(run._id, {
        agentSessionId: 'conv-handle-secret',
        sessionCreatedAt: 111,
      });
    });

    const asEditor = t.withIdentity({ subject: EDITOR });
    const op = await asEditor.query(
      api.tasks.queries.getTaskAgentRunSandboxOp,
      {
        organizationId: ORG,
        runId: run._id,
      },
    );
    const card = await asEditor.query(
      api.tasks.queries.getLatestTaskAgentRunForTask,
      { organizationId: ORG, taskId },
    );
    expect(JSON.stringify(op)).not.toContain('conv-handle-secret');
    expect(JSON.stringify(card)).not.toContain('conv-handle-secret');
    expect(JSON.stringify(card)).not.toContain('sessionCreatedAt');
  });

  it('fails closed for a non-member', async () => {
    const t = convexTest(schema, modules);
    const { run } = await seedRun(t);
    await seedOp(t, run, { progressText: 'private' });

    const op = await t
      .withIdentity({ subject: STRANGER })
      .query(api.tasks.queries.getTaskAgentRunSandboxOp, {
        organizationId: ORG,
        runId: run._id,
      });
    expect(op).toBeNull();
  });

  it('fails closed when the org does not own the run', async () => {
    const t = convexTest(schema, modules);
    const { run } = await seedRun(t);
    await seedOp(t, run, { progressText: 'private' });

    const op = await t
      .withIdentity({ subject: EDITOR })
      .query(api.tasks.queries.getTaskAgentRunSandboxOp, {
        organizationId: 'org_other',
        runId: run._id,
      });
    expect(op).toBeNull();
  });
});

describe('getLatestTaskAgentRunForTask agent name', () => {
  it('carries the agent’s display name for the details dialog title', async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await seedRun(t);

    const card = await t
      .withIdentity({ subject: EDITOR })
      .query(api.tasks.queries.getLatestTaskAgentRunForTask, {
        organizationId: ORG,
        taskId,
      });
    expect(card).toMatchObject({ agentName: 'Alice' });
  });
});
