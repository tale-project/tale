/**
 * The ask-a-human lifecycle behind `ask_human` — the data layer the bridge,
 * the agent host, and the answer card all trust. What these pin: the ask can
 * only ever attach to the run its SESSION proves (nothing client-supplied
 * picks the run, the node, or the exec), a second question folds instead of
 * multiplying cards, the public surfaces are membership-gated and go quiet on
 * dead runs, and the cursor retarget refuses everything but the exact parked
 * turn it was issued for.
 */

import { convexTest, type TestConvex } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api, internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { sessionIdForWorkflowExecution } from '../sandbox/session_naming';
import schema from '../schema';

const TEST_DIR_FROM_CONVEX_ROOT = 'automations';
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

type T = TestConvex<typeof schema>;

const ORG = 'org_asks';
const OTHER_ORG = 'org_asks_other';
const MEMBER = 'u_asker';
const EXEC = 'exec-ask-1';
const NODE = 'repair_setup';

async function seedMember(t: T, organizationId: string): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert('memberMirror', {
      memberId: `m_${MEMBER}_${organizationId}`,
      userId: MEMBER,
      organizationId,
      role: 'editor',
      createdAt: 0,
    });
  });
}

/** A live run parked on its agent node, with the session row that proves it. */
async function seedParkedRun(
  t: T,
  overrides: {
    status?: 'waiting' | 'success';
    cursor?: boolean;
    taskId?: string;
  } = {},
): Promise<{ runId: Id<'automationRuns'>; sessionId: string }> {
  const runId = await t.run(async (ctx) =>
    ctx.db.insert('automationRuns', {
      organizationId: ORG,
      name: 'vat-return-desk',
      version: 1,
      status: overrides.status ?? 'waiting',
      mode: 'live',
      startedBy: `user:${MEMBER}`,
      input:
        overrides.taskId !== undefined
          ? { task: { id: overrides.taskId } }
          : {},
      startedAt: 0,
      checkpoints: {
        nodes: {},
        executions: 1,
        ...(overrides.cursor === false
          ? {}
          : {
              cursor: {
                node: NODE,
                index: 0,
                passes: 0,
                outs: [],
                agent: {
                  execId: EXEC,
                  sessionId: sessionIdForWorkflowExecution('placeholder'),
                  deadlineAt: 9_999_999,
                  providerSlug: 'openrouter',
                  gatewayModel: 'z-ai/glm-5.2',
                  harness: 'claude-code',
                  input: { model: 'glm', prompt: 'fix it' },
                },
              },
            }),
      },
    }),
  );
  const sessionId = sessionIdForWorkflowExecution(String(runId));
  await t.run(async (ctx) => {
    await ctx.db.insert('sandboxSessions', {
      organizationId: ORG,
      sessionId,
      profile: 'agent',
      status: 'active',
      ownerType: 'workflow_run',
      ownerId: `${String(runId)}:@workflow`,
      createdBy: 'system:automation',
      createdAt: 0,
      expiresAt: 9_999_999,
    });
  });
  return { runId, sessionId };
}

function createAsk(t: T, sessionId: string, question: string, org = ORG) {
  return t.mutation(internal.automations.human_asks.createAskForExec, {
    organizationId: org,
    sessionId,
    question,
  });
}

/** A real task row, so the run input's `task.id` normalizes. */
async function seedTask(t: T): Promise<Id<'tasks'>> {
  return t.run(async (ctx) => {
    const projectId = await ctx.db.insert('projects', {
      organizationId: ORG,
      name: 'VAT desk',
      createdBy: MEMBER,
      createdAt: 0,
      updatedAt: 0,
    });
    return await ctx.db.insert('tasks', {
      organizationId: ORG,
      projectId,
      title: 'VAT return 2026Q1',
      status: 'in_progress',
      rank: 'a0',
      createdBy: MEMBER,
      createdByType: 'user',
      createdAt: 0,
      updatedAt: 0,
    });
  });
}

describe('createAskForExec', () => {
  it('attaches the question to the run the session proves, exec and node from the cursor', async () => {
    const t = convexTest(schema, modules);
    const taskId = await seedTask(t);
    const { runId, sessionId } = await seedParkedRun(t, {
      taskId: String(taskId),
    });

    const created = await createAsk(t, sessionId, 'Which amount governs?');

    expect(created).toMatchObject({
      question: 'Which amount governs?',
      folded: false,
      taskId,
    });
    if ('refused' in created) throw new Error('unexpected refusal');
    const row = await t.run((ctx) => ctx.db.get(created.askId));
    expect(row).toMatchObject({
      organizationId: ORG,
      runId,
      nodeId: NODE,
      execId: EXEC,
      status: 'pending',
    });
    expect(row?.expiresAt).toBeGreaterThan(Date.now());
  });

  it('treats a garbage task reference as "no task" instead of failing the ask', async () => {
    const t = convexTest(schema, modules);
    const { sessionId } = await seedParkedRun(t, { taskId: 'not-a-task-id' });

    const created = await createAsk(t, sessionId, 'Still works?');

    if ('refused' in created) throw new Error('unexpected refusal');
    expect(created.taskId).toBeUndefined();
  });

  it('folds a second question into the pending row instead of a second card', async () => {
    const t = convexTest(schema, modules);
    const { sessionId } = await seedParkedRun(t);

    const first = await createAsk(t, sessionId, 'Question one?');
    const second = await createAsk(t, sessionId, 'Question two?');

    if ('refused' in first || 'refused' in second) {
      throw new Error('unexpected refusal');
    }
    expect(second.folded).toBe(true);
    expect(second.askId).toBe(first.askId);
    const row = await t.run((ctx) => ctx.db.get(first.askId));
    expect(row?.question).toBe('Question one?\n\nQuestion two?');
  });

  it('refuses an unknown session, a finished run, and a run with no live turn', async () => {
    const t = convexTest(schema, modules);
    expect(await createAsk(t, 'ses-unknown', 'Anyone?')).toHaveProperty(
      'refused',
    );

    const finished = await seedParkedRun(t, { status: 'success' });
    expect(await createAsk(t, finished.sessionId, 'Too late?')).toHaveProperty(
      'refused',
    );

    const cursorless = await seedParkedRun(t, { cursor: false });
    expect(await createAsk(t, cursorless.sessionId, 'No turn?')).toHaveProperty(
      'refused',
    );
  });

  it('refuses a caller naming another organization than the session’s', async () => {
    const t = convexTest(schema, modules);
    const { sessionId } = await seedParkedRun(t);
    expect(
      await createAsk(t, sessionId, 'Cross-org?', OTHER_ORG),
    ).toHaveProperty('refused');
  });
});

describe('answerAsk + getPendingAskForRun', () => {
  it('lets a member answer once; the pending card clears reactively', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG);
    const { runId, sessionId } = await seedParkedRun(t);
    const created = await createAsk(t, sessionId, 'Which amount governs?');
    if ('refused' in created) throw new Error('unexpected refusal');

    const asMember = t.withIdentity({ subject: MEMBER });
    const pending = await asMember.query(
      api.automations.human_asks.getPendingAskForRun,
      { organizationId: ORG, runId },
    );
    expect(pending).toMatchObject({
      askId: created.askId,
      nodeId: NODE,
      question: 'Which amount governs?',
    });

    await asMember.mutation(api.automations.human_asks.answerAsk, {
      organizationId: ORG,
      askId: created.askId,
      answer: 'The invoice copy: 1580.00 net.',
    });

    const row = await t.run((ctx) => ctx.db.get(created.askId));
    expect(row).toMatchObject({
      status: 'answered',
      answer: 'The invoice copy: 1580.00 net.',
      answeredBy: MEMBER,
    });
    expect(
      await asMember.query(api.automations.human_asks.getPendingAskForRun, {
        organizationId: ORG,
        runId,
      }),
    ).toBeNull();

    // Answered means answered — a second submission is refused.
    await expect(
      asMember.mutation(api.automations.human_asks.answerAsk, {
        organizationId: ORG,
        askId: created.askId,
        answer: 'Changed my mind.',
      }),
    ).rejects.toThrow();
  });

  it('shows nothing to a non-member and nothing on a dead run', async () => {
    const t = convexTest(schema, modules);
    const { runId, sessionId } = await seedParkedRun(t);
    const created = await createAsk(t, sessionId, 'Secret?');
    if ('refused' in created) throw new Error('unexpected refusal');

    // Identity present, but no membership in ORG.
    expect(
      await t
        .withIdentity({ subject: 'u_outsider' })
        .query(api.automations.human_asks.getPendingAskForRun, {
          organizationId: ORG,
          runId,
        }),
    ).toBeNull();

    await seedMember(t, ORG);
    await t.run(async (ctx) => {
      await ctx.db.patch(runId, { status: 'cancelled' });
    });
    expect(
      await t
        .withIdentity({ subject: MEMBER })
        .query(api.automations.human_asks.getPendingAskForRun, {
          organizationId: ORG,
          runId,
        }),
    ).toBeNull();
  });
});

describe('retargetAgentCursor + closeAsk', () => {
  it('moves the parked cursor onto the resumed exec, guarded by the old one', async () => {
    const t = convexTest(schema, modules);
    const { runId } = await seedParkedRun(t);

    const wrong = await t.mutation(
      internal.automations.human_asks.retargetAgentCursor,
      {
        organizationId: ORG,
        runId,
        nodeId: NODE,
        fromExecId: 'exec-stale',
        toExecId: 'exec-new',
      },
    );
    expect(wrong.retargeted).toBe(false);

    const right = await t.mutation(
      internal.automations.human_asks.retargetAgentCursor,
      {
        organizationId: ORG,
        runId,
        nodeId: NODE,
        fromExecId: EXEC,
        toExecId: 'exec-new',
        deadlineAt: 123_456_789,
      },
    );
    expect(right.retargeted).toBe(true);
    const run = await t.run((ctx) => ctx.db.get(runId));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- seeded above in this exact shape
    const checkpoints = run?.checkpoints as {
      cursor: { agent: { execId: string; deadlineAt: number } };
    };
    expect(checkpoints.cursor.agent.execId).toBe('exec-new');
    expect(checkpoints.cursor.agent.deadlineAt).toBe(123_456_789);
  });

  it('closes only pending asks', async () => {
    const t = convexTest(schema, modules);
    await seedMember(t, ORG);
    const { sessionId } = await seedParkedRun(t);
    const created = await createAsk(t, sessionId, 'Still there?');
    if ('refused' in created) throw new Error('unexpected refusal');

    await t.mutation(internal.automations.human_asks.closeAsk, {
      askId: created.askId,
      status: 'expired',
    });
    expect((await t.run((ctx) => ctx.db.get(created.askId)))?.status).toBe(
      'expired',
    );

    // Terminal rows stay put — a late cancel cannot overwrite the expiry.
    await t.mutation(internal.automations.human_asks.closeAsk, {
      askId: created.askId,
      status: 'cancelled',
    });
    expect((await t.run((ctx) => ctx.db.get(created.askId)))?.status).toBe(
      'expired',
    );
  });
});
