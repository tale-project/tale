/**
 * The kick-time start plan over PG: the resume DECISION is the reused pure
 * core (`task_kick_resume.test.ts` owns it); what this locks is the row walk
 * around it — above all that the predecessor exec travels to the start
 * whether or not its conversation is resumed. A harness switch starts a
 * fresh conversation, but the old CLI can still be alive (a drain that died
 * on a transport failure settled its run with the process running), and the
 * start must reap it before launching beside it.
 */

import { describe, expect, it } from 'vitest';

import { resolveTaskKickStartArgs } from './kick-plan.ts';

interface RunRow {
  status: string;
  agentId: string;
  harness: string;
  sessionId: string;
  execId: string;
  agentSessionId: string | null;
  sessionCreatedAt: number | null;
  startedAt: number;
  brokerTokenHash: string | null;
  apiErrorStatus: number | null;
  failureCode: string | null;
  launchedAt: number | null;
  settledAt: number | null;
}

/** A tagged-template stand-in for `postgres`, keyed by the table a query
 * reads: the live session row, the task's newest-first run rows, and the
 * per-run op row fallback for rows predating the handle stamp. */
function fakeSql(fixture: {
  liveSession?: { createdAt: number };
  runs: RunRow[];
  ops?: Record<string, { agentSessionId: string | null }>;
}) {
  const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join('?');
    if (query.includes('FROM app.sandbox_sessions')) {
      return fixture.liveSession === undefined ? [] : [fixture.liveSession];
    }
    if (query.includes('FROM app.project_agent_runs')) return fixture.runs;
    if (query.includes('FROM app.sandbox_session_ops')) {
      const execId = String(values[1]);
      const op = fixture.ops?.[execId];
      return op === undefined ? [] : [op];
    }
    throw new Error(`unexpected query: ${query}`);
  };
  return sql as never;
}

const KICK = {
  organizationId: 'org-1',
  taskId: 'task-1',
  agentId: 'alice',
  sessionId: 'pa-alice',
};

function run(overrides: Partial<RunRow>): RunRow {
  return {
    status: 'failed',
    agentId: 'alice',
    harness: 'claude-code',
    sessionId: 'pa-alice',
    execId: 'exec-old',
    agentSessionId: 'conv-claude-old',
    sessionCreatedAt: 1000,
    startedAt: 2000,
    brokerTokenHash: null,
    apiErrorStatus: null,
    failureCode: null,
    launchedAt: 2100,
    settledAt: 3000,
    ...overrides,
  };
}

/** A failed run the broker's refresh cut: a 401 on a brokered turn. */
function rotated(overrides: Partial<RunRow>): RunRow {
  return run({
    failureCode: 'credential_rotated',
    apiErrorStatus: 401,
    ...overrides,
  });
}

describe('resolveTaskKickStartArgs', () => {
  it('carries the predecessor exec across a harness switch (no resume)', async () => {
    const plan = await resolveTaskKickStartArgs(
      fakeSql({ liveSession: { createdAt: 1000 }, runs: [run({})] }),
      { ...KICK, harness: 'codex' },
    );

    // A foreign CLI cannot continue the conversation — fresh, keeping the
    // failed predecessor's box — but its process is still this session's
    // to reap.
    expect(plan.resume).toBeUndefined();
    expect(plan.sweep).toBe(false);
    expect(plan.inspectNote).toBe(true);
    expect(plan.predecessorExecId).toBe('exec-old');
  });

  it('carries the predecessor exec alongside a same-harness resume', async () => {
    const plan = await resolveTaskKickStartArgs(
      fakeSql({
        liveSession: { createdAt: 1000 },
        runs: [run({ status: 'settled' })],
      }),
      { ...KICK, harness: 'claude-code' },
    );

    expect(plan).toEqual({
      resume: 'conv-claude-old',
      resumeSessionCreatedAt: 1000,
      resumeDiscussionSince: 2000,
      predecessorExecId: 'exec-old',
      sweep: true,
      inspectNote: false,
    });
  });

  it('never reaps another session’s exec', async () => {
    const plan = await resolveTaskKickStartArgs(
      fakeSql({
        liveSession: { createdAt: 1000 },
        // A run of another agent — its box and process live elsewhere.
        runs: [run({ agentId: 'bob', sessionId: 'pa-bob' })],
      }),
      { ...KICK, harness: 'claude-code' },
    );

    expect(plan.predecessorExecId).toBeUndefined();
    expect(plan.resume).toBeUndefined();
    expect(plan.sweep).toBe(true);
  });

  it('skips a predecessor that never launched an exec', async () => {
    const plan = await resolveTaskKickStartArgs(
      fakeSql({
        liveSession: { createdAt: 1000 },
        runs: [
          // Died before the harness announced a conversation, and no op
          // row: never launched — the walk looks further back.
          run({ execId: 'exec-dead', agentSessionId: null }),
          run({ status: 'settled', execId: 'exec-older' }),
        ],
        ops: {},
      }),
      { ...KICK, harness: 'claude-code' },
    );

    expect(plan.predecessorExecId).toBe('exec-older');
    expect(plan.resume).toBe('conv-claude-old');
  });

  it('resumes a credential rotation on the same account pool, burning only real failures', async () => {
    const plan = await resolveTaskKickStartArgs(
      fakeSql({
        liveSession: { createdAt: 1000 },
        runs: [
          // The retry being started.
          run({ status: 'queued', execId: 'exec-new', agentSessionId: null }),
          rotated({
            execId: 'exec-rotated',
            agentSessionId: 'conv-rotated',
            brokerTokenHash: 'account-a',
          }),
          run({ execId: 'exec-crashed', brokerTokenHash: 'account-b' }),
        ],
      }),
      { ...KICK, harness: 'claude-code' },
    );

    // The conversation continues, and the account whose token was refreshed
    // under it stays in the pool; the one that crashed is stepped past.
    expect(plan.resume).toBe('conv-rotated');
    expect(plan.predecessorExecId).toBe('exec-rotated');
    expect(plan.excludeBrokerTokenHashes).toEqual(['account-b']);
  });

  it('keeps a model-capacity account eligible without forgiving other failed accounts', async () => {
    const plan = await resolveTaskKickStartArgs(
      fakeSql({
        liveSession: { createdAt: 1000 },
        runs: [
          run({
            failureCode: 'model_capacity',
            harness: 'codex',
            brokerTokenHash: 'capacity-account',
          }),
          run({
            failureCode: 'harness_error',
            apiErrorStatus: 429,
            brokerTokenHash: 'limited-account',
          }),
        ],
      }),
      { ...KICK, harness: 'codex' },
    );
    expect(plan.excludeBrokerTokenHashes).toEqual(['limited-account']);
    expect(plan.predecessorExecId).toBe('exec-old');
    expect(plan.resume).toBe('conv-claude-old');
  });

  it('burns the account on the third rotation in a row', async () => {
    const plan = await resolveTaskKickStartArgs(
      fakeSql({
        liveSession: { createdAt: 1000 },
        runs: [
          rotated({ execId: 'exec-3', brokerTokenHash: 'account-c' }),
          rotated({ execId: 'exec-2', brokerTokenHash: 'account-b' }),
          rotated({ execId: 'exec-1', brokerTokenHash: 'account-a' }),
        ],
      }),
      { ...KICK, harness: 'claude-code' },
    );

    // The first two stay free; the third takes the ordinary path.
    expect(plan.excludeBrokerTokenHashes).toEqual(['account-c']);
  });

  it('plans a first start with nothing to reap', async () => {
    const plan = await resolveTaskKickStartArgs(fakeSql({ runs: [] }), {
      ...KICK,
      harness: 'claude-code',
    });

    expect(plan).toEqual({ sweep: true, inspectNote: false });
  });
});
