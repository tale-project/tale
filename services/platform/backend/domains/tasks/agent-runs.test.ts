import type { Sql, TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { readGovernancePolicyForOrg } from '../../lib/org-config.ts';
import {
  AGENT_RUN_FEEDBACK_EXCERPT_CHARS,
  cancelAgentRunInTx,
  failAgentRun,
  failAgentRunFromTurn,
  getLatestAgentRunCardForTask,
  kickAgentRun,
  launchAgentRun,
  listTaskAgentRunSummaries,
  settleAgentRun,
  wakeOrganizationParkedAgentRun,
  wakeParkedAgentRuns,
} from './agent-runs.ts';
import {
  announceAgentRunFailed,
  withdrawAgentRunFailedNotices,
} from './run-failure-notice.ts';
import { recordTaskAgentRunLedgerEntry } from './run-ledger.ts';

vi.mock('../../lib/org-config.ts', () => ({
  readGovernancePolicyForOrg: vi.fn().mockResolvedValue(null),
}));
vi.mock('./run-ledger.ts', () => ({ recordTaskAgentRunLedgerEntry: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('./run-failure-notice.ts', () => ({
  announceAgentRunFailed: vi.fn(),
  withdrawAgentRunFailedNotices: vi.fn(),
}));
vi.mock('../sandbox/gateway-keys.ts', () => ({
  revokeSessionGatewayKeys: vi.fn(async () => {}),
}));

type Row = Record<string, unknown>;

/** A postgres.js tagged-template stand-in answering each statement from its
 * (whitespace-collapsed) text; the statements are what these tests pin. */
function fakeTx(answer: (text: string) => Row[]): {
  tx: TransactionSql;
  statements: string[];
  calls: { text: string; values: unknown[] }[];
} {
  const statements: string[] = [];
  const calls: { text: string; values: unknown[] }[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Row[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    calls.push({ text, values });
    return Promise.resolve(answer(text));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js template function
  return { tx: tag as unknown as TransactionSql, statements, calls };
}

const KEYS = { organizationId: 'org-1', runId: 'run-1', taskId: 'task-1' };

/** The parked-run wake's claim, as its statement opens. */
const CLAIM =
  'SELECT r.id, r.org_id AS "organizationId", r.exec_id AS "execId", r.task_id AS "taskId" FROM app.project_agent_runs r';

describe('cancelAgentRunInTx — the run must belong to the authorized task', () => {
  beforeEach(() => {
    vi.mocked(recordTaskAgentRunLedgerEntry).mockReset();
  });

  it('binds the cancel to the task in the SAME guard as the org and status', async () => {
    // The authorization happened on the URL's task; a run id from another
    // task (IDOR) must never match — the task binding is part of the UPDATE
    // predicate itself, not a separate read a racing caller could slip past.
    const { tx, statements } = fakeTx(() => []);
    const cancelled = await cancelAgentRunInTx(tx, KEYS);
    expect(cancelled).toBe(false);
    const update = statements.find((text) =>
      text.startsWith('UPDATE app.project_agent_runs'),
    );
    expect(update).toBeDefined();
    expect(update).toContain('WHERE id = ? AND org_id = ? AND task_id = ?');
    expect(update).toContain("status IN ('queued', 'running')");
    // A refused cancel writes no provenance entry — nothing was cancelled.
    expect(recordTaskAgentRunLedgerEntry).not.toHaveBeenCalled();
  });

  it('records the cancelled ledger entry when the bound run was live', async () => {
    const { tx } = fakeTx((text) =>
      text.startsWith('UPDATE app.project_agent_runs')
        ? [
            {
              id: 'run-1',
              execId: 'exec-1',
              sessionId: 'pa-1',
              agentId: 'agent-1',
              harness: 'opencode',
              deadlineAt: 1000,
            },
          ]
        : [],
    );
    const cancelled = await cancelAgentRunInTx(tx, KEYS);
    expect(cancelled).toBe(true);
    expect(recordTaskAgentRunLedgerEntry).toHaveBeenCalledTimes(1);
    expect(recordTaskAgentRunLedgerEntry).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        runId: 'run-1',
        organizationId: 'org-1',
        finalStatus: 'cancelled',
      }),
    );
    expect(addJobInTx).toHaveBeenCalledWith(tx, 'task.agent_drive', {
      ...KEYS,
      execId: 'exec-1',
      sessionId: 'pa-1',
      agentId: 'agent-1',
      harness: 'opencode',
      deadlineAt: 1000,
    });
  });
});

/** A root `sql` stand-in whose `begin` hands the callback the same tagged
 * template — the terminal marks open their own transaction. */
function fakeSql(answer: (text: string) => Row[]): {
  sql: Sql;
  statements: string[];
  calls: { text: string; values: unknown[] }[];
} {
  const { tx, statements, calls } = fakeTx(answer);
  const sql = Object.assign(tx, {
    begin: (callback: (tx: TransactionSql) => unknown): unknown => callback(tx),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js root instance
  return { sql: sql as unknown as Sql, statements, calls };
}

describe('the turn host’s terminal marks write the provenance entry', () => {
  beforeEach(() => {
    vi.mocked(recordTaskAgentRunLedgerEntry).mockReset();
    vi.mocked(addJobInTx).mockReset();
  });

  it('settleAgentRun: the winning flip records `settled` in the same transaction', async () => {
    const { sql, statements } = fakeSql((text) =>
      text.startsWith('UPDATE app.project_agent_runs')
        ? [{ organizationId: 'org-1' }]
        : [],
    );
    await expect(
      settleAgentRun(sql, {
        runId: 'run-1',
        execId: 'exec-1',
        resultText: 'ok',
      }),
    ).resolves.toBe(true);
    const update = statements.find((text) =>
      text.startsWith('UPDATE app.project_agent_runs'),
    );
    // Exec-guarded and elected on the live statuses.
    expect(update).toContain(
      "status NOT IN ('settled', 'failed', 'cancelled')",
    );
    expect(update).toContain('OR exec_id = ?');
    expect(recordTaskAgentRunLedgerEntry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordTaskAgentRunLedgerEntry).mock.calls[0]?.[1]).toEqual(
      {
        runId: 'run-1',
        organizationId: 'org-1',
        finalStatus: 'settled',
        settledAt: expect.any(Number),
      },
    );
  });

  it('settleAgentRun: a lost election (already terminal / rotated exec) writes nothing', async () => {
    const { sql } = fakeSql(() => []);
    await expect(
      settleAgentRun(sql, {
        runId: 'run-1',
        execId: 'stale',
        resultText: 'ok',
      }),
    ).resolves.toBe(false);
    expect(recordTaskAgentRunLedgerEntry).not.toHaveBeenCalled();
  });

  it('failAgentRunFromTurn: records `failed` with the reason and arms the retry once', async () => {
    const { sql } = fakeSql((text) =>
      text.startsWith('UPDATE app.project_agent_runs')
        ? [{ organizationId: 'org-1', taskId: 'task-1', agentId: 'agent-1' }]
        : [],
    );
    await expect(
      failAgentRunFromTurn(sql, {
        runId: 'run-1',
        execId: 'exec-1',
        error: 'the harness crashed',
        failureCode: 'harness_error',
      }),
    ).resolves.toBe(true);
    expect(vi.mocked(recordTaskAgentRunLedgerEntry).mock.calls[0]?.[1]).toEqual(
      {
        runId: 'run-1',
        organizationId: 'org-1',
        finalStatus: 'failed',
        settledAt: expect.any(Number),
        error: 'the harness crashed',
      },
    );
    expect(addJobInTx).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addJobInTx).mock.calls[0]?.[1]).toBe('task.agent_retry');
  });

  describe('a start refused while every broker account cools down', () => {
    const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
    const failed = () =>
      fakeSql((text) =>
        text.startsWith('UPDATE app.project_agent_runs')
          ? [{ organizationId: 'org-1', taskId: 'task-1', agentId: 'agent-1' }]
          : [],
      ).sql;
    beforeEach(() => {
      vi.mocked(addJobInTx).mockReset();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(NOW);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('holds a counted model-capacity retry for one minute after settlement without a broker timestamp', async () => {
      await failAgentRunFromTurn(failed(), {
        runId: 'run-1',
        execId: 'exec-1',
        error: 'Selected model is at capacity. Please try a different model.',
        failureCode: 'model_capacity',
      });
      expect(addJobInTx).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        'task.agent_retry',
        {
          organizationId: 'org-1',
          taskId: 'task-1',
          agentId: 'agent-1',
          expectedRunId: 'run-1',
          startAfterMs: NOW + 60_000,
        },
      );
    });

    it('starts the model-capacity floor after a terminal-update lock wait, not before it', async () => {
      const { sql } = fakeSql((text) => {
        if (!text.startsWith('UPDATE app.project_agent_runs')) return [];
        vi.setSystemTime(NOW + 90_000);
        return [
          { organizationId: 'org-1', taskId: 'task-1', agentId: 'agent-1' },
        ];
      });
      await failAgentRunFromTurn(sql, {
        runId: 'run-1',
        execId: 'exec-1',
        error: 'model capacity',
        failureCode: 'model_capacity',
      });
      expect(addJobInTx).toHaveBeenCalledWith(
        expect.anything(),
        'task.agent_retry',
        expect.objectContaining({ startAfterMs: NOW + 150_000 }),
      );
    });

    it('arms the retry to start when the first account is back', async () => {
      await failAgentRunFromTurn(failed(), {
        runId: 'run-1',
        execId: 'exec-1',
        error: 'every account is cooling down',
        failureCode: 'start_failed',
        retryAtMs: NOW + 42_000,
      });
      expect(addJobInTx).toHaveBeenCalledWith(
        expect.anything(),
        'task.agent_retry',
        {
          organizationId: 'org-1',
          taskId: 'task-1',
          agentId: 'agent-1',
          expectedRunId: 'run-1',
          startAfterMs: NOW + 42_000,
        },
      );
    });

    it('never holds it past a cooldown, nor for one already over', async () => {
      await failAgentRunFromTurn(failed(), {
        runId: 'run-1',
        error: 'every account is cooling down',
        failureCode: 'start_failed',
        retryAtMs: NOW + 10 * 60_000,
      });
      await failAgentRunFromTurn(failed(), {
        runId: 'run-1',
        error: 'every account is cooling down',
        failureCode: 'start_failed',
        retryAtMs: NOW - 1,
      });
      expect(
        vi.mocked(addJobInTx).mock.calls.map(([, , payload]) => payload),
      ).toEqual([
        expect.objectContaining({ startAfterMs: NOW + 60_000 }),
        expect.not.objectContaining({ startAfterMs: expect.anything() }),
      ]);
    });
  });

  it('failAgentRunFromTurn: a non-retryable failure records the entry but arms nothing', async () => {
    const { sql } = fakeSql((text) =>
      text.startsWith('UPDATE app.project_agent_runs')
        ? [{ organizationId: 'org-1', taskId: 'task-1', agentId: 'agent-1' }]
        : [],
    );
    await failAgentRunFromTurn(sql, {
      runId: 'run-1',
      error: 'past the deadline',
      failureCode: 'deadline',
    });
    expect(recordTaskAgentRunLedgerEntry).toHaveBeenCalledTimes(1);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('failAgentRunFromTurn: a lost election writes no entry and arms no retry', async () => {
    const { sql } = fakeSql(() => []);
    await expect(
      failAgentRunFromTurn(sql, { runId: 'run-1', error: 'late' }),
    ).resolves.toBe(false);
    expect(recordTaskAgentRunLedgerEntry).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

/** The realtime hint every run write sends its task. */
const TASK_HINT = 'INSERT INTO app_realtime.outbox';

describe('launchAgentRun — the running flip is exec-fenced', () => {
  it('flips only a QUEUED run still owned by this exec, and says so', async () => {
    const { sql, statements } = fakeSql((text) =>
      text.startsWith('UPDATE app.project_agent_runs')
        ? [{ organizationId: 'org-1', taskId: 'task-1' }]
        : [],
    );
    await expect(
      launchAgentRun(sql, { runId: 'run-1', execId: 'exec-1' }),
    ).resolves.toBe(true);
    const update = statements.find((text) =>
      text.startsWith('UPDATE app.project_agent_runs'),
    );
    // The exec predicate is part of the UPDATE itself — a start whose exec
    // the queued-run recovery rotated away cannot flip (and so cannot spawn).
    expect(update).toContain('WHERE id = ? AND exec_id = ?');
    expect(update).toContain("status = 'queued'");
    expect(update).toContain('RETURNING org_id');
    // Queued → Working reaches an open task without a poll.
    expect(statements.some((text) => text.startsWith(TASK_HINT))).toBe(true);
  });

  it('a start under a rotated-away exec loses the launch, and hints nothing', async () => {
    const { sql, statements } = fakeSql(() => []);
    await expect(
      launchAgentRun(sql, { runId: 'run-1', execId: 'exec-stale' }),
    ).resolves.toBe(false);
    expect(statements.some((text) => text.startsWith(TASK_HINT))).toBe(false);
  });
});

describe('kickAgentRun — one live run per task is the schema’s rule', () => {
  beforeEach(() => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(null);
    vi.mocked(addJobInTx).mockReset();
  });

  const kick = {
    organizationId: 'org-1',
    projectId: 'p-1',
    taskId: 'task-1',
    agentId: 'agent-1',
    harness: 'claude-code',
    model: 'm',
    startedBy: 'u-1',
  };

  it('refuses new work when task automation is disabled, without scheduling a turn', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({ enabled: false });
    const { tx, statements } = fakeTx(() => []);
    await expect(kickAgentRun(tx, kick)).rejects.toMatchObject({
      code: 'TASK_AUTOMATION_DISABLED',
      status: 403,
    });
    expect(statements.some((text) => text.startsWith('INSERT'))).toBe(false);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('keeps an existing run available while new task work is disabled', async () => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue({ enabled: false });
    const { tx } = fakeTx((text) =>
      text.startsWith('SELECT id, exec_id')
        ? [{ id: 'standing', execId: 'exec' }]
        : [],
    );
    await expect(kickAgentRun(tx, kick)).resolves.toEqual({
      runId: 'standing',
      execId: 'exec',
      reused: true,
    });
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('inserts under the live-run unique index and enqueues the turn on a win', async () => {
    const { tx, statements } = fakeTx((text) =>
      text.startsWith('INSERT INTO app.project_agent_runs')
        ? [{ id: 'run-new' }]
        : [],
    );
    const result = await kickAgentRun(tx, kick);
    expect(result.reused).toBe(false);
    expect(result.runId).toBe('run-new');
    expect(statements[0]).toContain('UPDATE app.tasks');
    expect(statements[1]).toContain('SELECT id FROM app.automation_runs');
    const insert = statements.find((text) =>
      text.startsWith('INSERT INTO app.project_agent_runs'),
    );
    // The partial unique index's predicate, so a concurrent mint the probe
    // could not see (READ COMMITTED) is a no-op instead of a second live run.
    expect(insert).toContain(
      "ON CONFLICT (task_id) WHERE status IN ('queued', 'running') DO NOTHING",
    );
    expect(addJobInTx).toHaveBeenCalledTimes(1);
    expect(vi.mocked(addJobInTx).mock.calls[0]?.[1]).toBe('task.agent_turn');
    // Started at once.
    expect(vi.mocked(addJobInTx).mock.calls[0]?.[3]).toEqual({});
  });

  it('queues a retry at once but holds its start until a cooling broker has an account back', async () => {
    const { tx } = fakeTx((text) =>
      text.startsWith('INSERT INTO app.project_agent_runs')
        ? [{ id: 'run-new' }]
        : [],
    );
    const startAfterMs = Date.now() + 42_000;
    await kickAgentRun(tx, {
      ...kick,
      trigger: 'auto_retry',
      autoRetryAttempt: 2,
      startAfterMs,
    });
    expect(addJobInTx).toHaveBeenCalledWith(
      tx,
      'task.agent_turn',
      expect.objectContaining({ runId: 'run-new' }),
      { startAfter: new Date(startAfterMs) },
    );
  });

  it('refuses a live automation without creating an agent run or launch job', async () => {
    const { tx, statements } = fakeTx((text) =>
      text.startsWith('SELECT id FROM app.automation_runs')
        ? [{ id: 'automation-live' }]
        : [],
    );
    await expect(kickAgentRun(tx, kick)).rejects.toMatchObject({
      code: 'TASK_HAS_LIVE_RUN',
      status: 409,
    });
    expect(statements.some((text) => text.startsWith('INSERT'))).toBe(false);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('a lost insert answers with the concurrent winner’s run and enqueues nothing', async () => {
    let probes = 0;
    const { tx } = fakeTx((text) => {
      if (text.startsWith('SELECT id, exec_id AS "execId"')) {
        probes += 1;
        // The first probe misses (the winner is not yet visible); the
        // re-read after the refused insert finds it.
        return probes === 1 ? [] : [{ id: 'run-winner', execId: 'exec-w' }];
      }
      return [];
    });
    const result = await kickAgentRun(tx, kick);
    expect(result).toEqual({
      runId: 'run-winner',
      execId: 'exec-w',
      reused: true,
    });
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});

describe('kickAgentRun — the workspace follows the person who starts the run', () => {
  beforeEach(() => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(null);
    vi.mocked(addJobInTx).mockReset();
  });

  /** The kick's statements with their values, answering the starter's
   * membership and the project's audience from the case. */
  function kickTx(role: string | null): {
    tx: TransactionSql;
    sessionId: () => unknown;
  } {
    let inserted: unknown[] = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
      if (text.includes('FROM "member"')) {
        return Promise.resolve(
          role === null
            ? []
            : [{ id: 'm-1', organizationId: 'org-1', userId: 'u-1', role }],
        );
      }
      if (text.includes('AS "teamIds" FROM app.projects')) {
        return Promise.resolve([{ teamIds: [] }]);
      }
      if (text.startsWith('INSERT INTO app.project_agent_runs')) {
        inserted = values;
        return Promise.resolve([{ id: 'run-new' }]);
      }
      return Promise.resolve([]);
    };
    const tx = Object.assign(tag, { unsafe: (text: string) => text });
    return {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js transaction function
      tx: tx as unknown as TransactionSql,
      // The insert binds org, project, task, agent, exec, then the session.
      sessionId: () => inserted[5],
    };
  }

  const kick = {
    organizationId: 'org-1',
    projectId: 'p-1',
    taskId: 'task-1',
    agentId: 'agent-1',
    harness: 'claude-code',
    model: 'm',
    startedBy: 'u-1',
  };

  it("joins the agent's standing workspace for a project editor", async () => {
    for (const role of ['owner', 'admin', 'developer', 'editor']) {
      const { tx, sessionId } = kickTx(role);
      await kickAgentRun(tx, kick);
      expect(sessionId()).toBe('pa-agent-1');
    }
  });

  it('works in a workspace of its own for a member, apart from the standing one and from other members', async () => {
    const { tx, sessionId } = kickTx('member');
    await kickAgentRun(tx, kick);
    const own = sessionId();
    expect(own).toMatch(/^pa-agent-1-m[0-9a-f]{16}$/);
    const other = kickTx('member');
    await kickAgentRun(other.tx, { ...kick, startedBy: 'u-2' });
    expect(other.sessionId()).not.toBe(own);
    // The same member keeps their workspace from run to run.
    const again = kickTx('member');
    await kickAgentRun(again.tx, kick);
    expect(again.sessionId()).toBe(own);
  });

  it('treats a starter who is no longer a member like a member', async () => {
    const { tx, sessionId } = kickTx(null);
    await kickAgentRun(tx, kick);
    expect(sessionId()).not.toBe('pa-agent-1');
  });

  it('works in the workspace a caller already chose and judged — the automatic retry’s', async () => {
    // An editor would join the standing workspace; the caller's choice wins,
    // so the run lands where the caller's busy probe looked.
    const { tx, sessionId } = kickTx('editor');
    await kickAgentRun(tx, { ...kick, sessionId: 'pa-agent-1-mchosen' });
    expect(sessionId()).toBe('pa-agent-1-mchosen');
  });
});

describe('wakeParkedAgentRuns — the deadline lane owns a parked run past its deadline', () => {
  beforeEach(() => {
    vi.mocked(addJobInTx).mockReset();
  });

  it('skips a parked run whose deadline has passed in the claim predicate itself', async () => {
    // Regression: the release-edge wake fires from the SAME watchdog sweep
    // that fails overdue parked runs. Without the deadline guard the wake
    // un-parked an overdue run (clearing waiting_for_capacity_at_ms and
    // enqueueing its turn) before the deadline lane looked for it, so the
    // run launched past its time limit instead of being stopped.
    const { sql, statements } = fakeSql(() => []);
    const woken = await wakeParkedAgentRuns(sql, 'org-1');
    expect(woken).toBe(0);
    const claim = statements.find((text) => text.startsWith(CLAIM));
    expect(claim).toBeDefined();
    expect(claim).toContain("status = 'queued'");
    expect(claim).toContain('waiting_for_capacity_at_ms IS NOT NULL');
    expect(claim).toContain('deadline_at_ms > ?');
    expect(claim).toContain('FOR UPDATE OF r SKIP LOCKED');
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('wakes the parked run of the agent with the fewest runs working first, then the oldest park', async () => {
    const { sql, statements } = fakeSql(() => []);
    await wakeOrganizationParkedAgentRun(sql, 'org-1');
    const claim = statements.find((text) => text.startsWith(CLAIM)) ?? '';
    const order = claim.slice(claim.indexOf('ORDER BY'));
    // The agent's working runs count first: one agent's burst of parked
    // runs never stands ahead of every other agent's later start.
    expect(order).toContain('working.agent_id = r.agent_id');
    expect(order).toContain("working.status = 'running'");
    expect(order.indexOf('working.agent_id')).toBeLessThan(
      order.indexOf('r.waiting_for_capacity_at_ms'),
    );
  });

  it('un-parks the claimed run and re-enqueues its turn in the same transaction', async () => {
    const { sql, statements } = fakeSql((text) =>
      text.startsWith(CLAIM)
        ? [{ id: 'run-1', organizationId: 'org-1', execId: 'exec-1' }]
        : [],
    );
    const woken = await wakeOrganizationParkedAgentRun(sql, 'org-1');
    expect(woken).toBe(1);
    expect(
      statements.some(
        (text) =>
          text.startsWith('UPDATE app.project_agent_runs SET') &&
          text.includes('waiting_for_capacity_at_ms = NULL'),
      ),
    ).toBe(true);
    expect(addJobInTx).toHaveBeenCalledWith(
      expect.anything(),
      'task.agent_turn',
      {
        organizationId: 'org-1',
        runId: 'run-1',
        execId: 'exec-1',
      },
    );
  });
});

describe('wakeParkedAgentRuns — the release edge reaches every organization', () => {
  beforeEach(() => {
    vi.mocked(addJobInTx).mockReset();
  });

  it("claims the organization's oldest parked run, then the oldest of every other organization", async () => {
    const { sql, calls } = fakeSql((text) =>
      text.startsWith(CLAIM)
        ? [{ id: 'run-1', organizationId: 'org-2', execId: 'exec-1' }]
        : [],
    );

    const woken = await wakeParkedAgentRuns(sql, 'org-1');

    expect(woken).toBe(2);
    const claims = calls.filter((call) => call.text.startsWith(CLAIM));
    expect(claims.map((call) => call.text)).toEqual([
      expect.stringContaining(
        'WHERE CASE WHEN ? THEN r.org_id = ? ELSE r.org_id <> ? END',
      ),
      expect.stringContaining(
        'WHERE CASE WHEN ? THEN r.org_id = ? ELSE r.org_id <> ? END',
      ),
    ]);
    expect(claims.map((call) => call.values.slice(0, 3))).toEqual([
      [true, 'org-1', 'org-1'],
      [false, 'org-1', 'org-1'],
    ]);
    // The turn job names the woken run's own organization.
    expect(addJobInTx).toHaveBeenLastCalledWith(
      expect.anything(),
      'task.agent_turn',
      { organizationId: 'org-2', runId: 'run-1', execId: 'exec-1' },
    );
  });

  it('still reaches the other organizations when its own claim fails, and reports the failure', async () => {
    let first = true;
    const { sql, calls } = fakeSql((text) => {
      if (text.startsWith(CLAIM) && first) {
        first = false;
        throw new Error('deadlock detected');
      }
      return [];
    });

    await expect(wakeParkedAgentRuns(sql, 'org-1')).rejects.toThrow(
      'deadlock detected',
    );
    expect(calls.filter((call) => call.text.startsWith(CLAIM))).toHaveLength(2);
  });
});

describe('listTaskAgentRunSummaries — the runs an agent reading its task sees', () => {
  /** Records each statement's text and values. */
  function recording(): {
    sql: Sql;
    statements: { text: string; values: unknown[] }[];
  } {
    const statements: { text: string; values: unknown[] }[] = [];
    const tag = (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ): Promise<Row[]> => {
      statements.push({
        text: strings.join('?').replaceAll(/\s+/g, ' ').trim(),
        values,
      });
      return Promise.resolve([]);
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js template function
    return { sql: tag as unknown as Sql, statements };
  }

  it('walks the tie-free creation order, newest first, from before a page', async () => {
    const { sql, statements } = recording();
    await listTaskAgentRunSummaries(sql, {
      organizationId: 'org-1',
      taskId: 'task-1',
      limit: 6,
      beforeSeq: 41,
    });
    const [read] = statements;
    expect(read?.text).toContain('ORDER BY seq DESC');
    expect(read?.text).toContain('OR seq < ?::bigint');
    expect(read?.text).toContain('WHERE org_id = ? AND task_id = ?');
    expect(read?.values).toEqual(
      expect.arrayContaining(['org-1', 'task-1', 41, 6]),
    );
  });

  it('binds an exact requested run to both the organization and task', async () => {
    const { sql, statements } = recording();
    await listTaskAgentRunSummaries(sql, {
      organizationId: 'org-1',
      taskId: 'task-1',
      limit: 1,
      runId: 'old-run',
    });
    expect(statements[0]?.text).toContain('WHERE org_id = ? AND task_id = ?');
    expect(statements[0]?.text).toContain('AND (?::text IS NULL OR id = ?)');
    expect(statements[0]?.values).toEqual(
      expect.arrayContaining(['org-1', 'task-1', 'old-run', 1]),
    );
  });

  it('reads identity, status, timing and a feedback excerpt — never the transcript or the workspace', async () => {
    const { sql, statements } = recording();
    await listTaskAgentRunSummaries(sql, {
      organizationId: 'org-1',
      taskId: 'task-1',
      limit: 5,
    });
    const text = statements[0]?.text ?? '';
    const selected = text.slice(0, text.indexOf('FROM app.project_agent_runs'));
    for (const column of [
      'error',
      'result_text',
      'result_message_id',
      'exec_id',
      'session_id',
      'agent_session_id',
      'broker_token_hash',
      'model',
      'harness',
      'started_by',
    ]) {
      expect(selected).not.toMatch(new RegExp(`\\b${column}\\b`));
    }
    expect(selected).toContain('left(feedback, ?) AS feedback');
    // A cancelled run keeps its park stamp; only a queued one is waiting.
    expect(selected).toContain(
      "(status = 'queued' AND waiting_for_capacity_at_ms IS NOT NULL)",
    );
    expect(statements[0]?.values).toContain(AGENT_RUN_FEEDBACK_EXCERPT_CHARS);
  });

  it('bounds one read', async () => {
    const { sql, statements } = recording();
    for (const limit of [0, 1_000]) {
      await listTaskAgentRunSummaries(sql, {
        organizationId: 'org-1',
        taskId: 'task-1',
        limit,
      });
    }
    expect(statements.map((statement) => statement.values.at(-1))).toEqual([
      1, 100,
    ]);
  });

  const summary = (overrides: Row = {}) => ({
    id: 'run-1',
    seq: 4,
    agentId: 'agent-1',
    agentExists: true,
    status: 'failed',
    trigger: 'auto_retry',
    startedAt: 1,
    launchedAt: 2,
    settledAt: 3,
    waitingForCapacity: false,
    failureCode: 'harness_error',
    feedback: null,
    feedbackTruncated: false,
    ...overrides,
  });

  const history = (overrides: Row = {}) => ({
    ...summary(),
    startedBy: 'user-1',
    apiErrorStatus: null,
    autoRetryAttempt: null,
    autoRetryArmedAt: 3,
    autoRetryRefusedAt: null,
    ...overrides,
  });

  async function readRetryState(
    rows: Row[],
    retryHistory: Row[],
    beforeSeq?: number,
    runId?: string,
  ) {
    const { sql, statements } = fakeSql((text) =>
      text.includes('auto_retry_refused_at_ms::float8') ? retryHistory : rows,
    );
    const runs = await listTaskAgentRunSummaries(sql, {
      organizationId: 'org-1',
      taskId: 'task-1',
      limit: 5,
      ...(beforeSeq !== undefined ? { beforeSeq } : {}),
      ...(runId !== undefined ? { runId } : {}),
    });
    return { runs, statements };
  }

  it('exposes an armed native retry without exposing the internal agent check', async () => {
    const { runs, statements } = await readRetryState([summary()], [history()]);
    expect(runs[0]).toMatchObject({ status: 'failed', retryPending: true });
    expect(runs[0]).not.toHaveProperty('agentExists');
    expect(runs[0]).not.toHaveProperty('error');
    expect(statements).toHaveLength(2);
  });

  it.each([
    ['unarmed', { autoRetryArmedAt: null }],
    ['retired', { autoRetryRefusedAt: 4 }],
    ['superseded', { id: 'newer-run' }],
    ['legacy in-place', { inPlace: true }],
  ])('exposes a %s retry as explicitly not pending', async (_kind, change) => {
    const { runs } = await readRetryState([summary()], [history(change)]);
    expect(runs[0]?.retryPending).toBe(false);
  });

  it('exposes an in-place retry with a captured decision as pending', async () => {
    const { runs } = await readRetryState(
      [summary()],
      [
        history({
          inPlace: true,
          inPlaceRetryStatus: 'todo',
          inPlaceRetryActivityId: '0',
        }),
      ],
    );
    expect(runs[0]?.retryPending).toBe(true);
  });

  it('uses the same exhausted failure budget as the run card', async () => {
    const { runs } = await readRetryState(
      [summary()],
      Array.from({ length: 4 }, (_, index) =>
        history({ id: index === 0 ? 'run-1' : `older-${index}` }),
      ),
    );
    expect(runs[0]?.retryPending).toBe(false);
  });

  it('does not mistake the first failed run of a history page for the latest run', async () => {
    const { runs } = await readRetryState(
      [summary({ id: 'older-run', seq: 2 })],
      [history()],
      3,
    );
    expect(runs[0]?.retryPending).toBe(false);
  });

  it('does not lend a newer armed retry to an exact historical requested run', async () => {
    const { runs } = await readRetryState(
      [summary({ id: 'old-run' })],
      [history()],
      undefined,
      'old-run',
    );
    expect(runs[0]).toMatchObject({ id: 'old-run', retryPending: false });
  });

  it('only the newest row can have a pending retry, with one budget read per page', async () => {
    const { runs, statements } = await readRetryState(
      [summary(), summary({ id: 'older-run', seq: 3 })],
      [history(), history({ id: 'older-run' })],
    );
    expect(runs.map((run) => run.retryPending)).toEqual([true, false]);
    expect(statements).toHaveLength(2);
  });

  it.each(['queued', 'running', 'settled', 'cancelled'])(
    'a %s run has no pending failure retry',
    async (status) => {
      const { runs, statements } = await readRetryState(
        [summary({ status })],
        [history()],
      );
      expect(runs[0]?.retryPending).toBe(false);
      expect(statements).toHaveLength(1);
    },
  );

  it('does not promise a retry for a deleted agent', async () => {
    const { runs, statements } = await readRetryState(
      [summary({ agentExists: false })],
      [history()],
    );
    expect(runs[0]?.retryPending).toBe(false);
    expect(statements).toHaveLength(1);
  });
});

describe('an open task follows its run: every run write hints the task', () => {
  const hinted = (statements: string[]) =>
    statements.filter((text) => text.startsWith(TASK_HINT)).length;

  beforeEach(() => {
    vi.mocked(readGovernancePolicyForOrg).mockResolvedValue(null);
    vi.mocked(addJobInTx).mockReset();
    vi.mocked(announceAgentRunFailed).mockReset();
    vi.mocked(withdrawAgentRunFailedNotices).mockReset();
  });

  it('a kick hints the task and withdraws the last failure’s unread notices', async () => {
    const { tx, statements } = fakeTx((text) =>
      text.startsWith('INSERT INTO app.project_agent_runs')
        ? [{ id: 'run-new' }]
        : [],
    );
    await kickAgentRun(tx, {
      organizationId: 'org-1',
      projectId: 'p-1',
      taskId: 'task-1',
      agentId: 'agent-1',
      harness: 'claude-code',
      model: 'm',
      startedBy: 'u-1',
    });
    expect(withdrawAgentRunFailedNotices).toHaveBeenCalledWith(tx, {
      organizationId: 'org-1',
      taskId: 'task-1',
    });
    expect(hinted(statements)).toBe(1);
  });

  it('a settle hints the task it settled', async () => {
    const { sql, statements } = fakeSql((text) =>
      text.startsWith('UPDATE app.project_agent_runs')
        ? [{ organizationId: 'org-1', taskId: 'task-1' }]
        : [],
    );
    await settleAgentRun(sql, { runId: 'run-1', resultText: 'done' });
    expect(hinted(statements)).toBe(1);
  });

  it('a cancel hints the task only when it cancelled something', async () => {
    const won = fakeTx((text) =>
      text.startsWith('UPDATE app.project_agent_runs')
        ? [
            {
              id: 'run-1',
              execId: 'exec-1',
              sessionId: 'pa-1',
              agentId: 'agent-1',
              harness: 'opencode',
              deadlineAt: 1000,
            },
          ]
        : [],
    );
    await cancelAgentRunInTx(won.tx, KEYS);
    expect(hinted(won.statements)).toBe(1);

    const lost = fakeTx(() => []);
    await cancelAgentRunInTx(lost.tx, KEYS);
    expect(hinted(lost.statements)).toBe(0);
  });

  it('a woken parked run hints its task', async () => {
    const { sql, statements } = fakeSql((text) =>
      text.startsWith(CLAIM)
        ? [
            {
              id: 'run-1',
              organizationId: 'org-1',
              execId: 'exec-1',
              taskId: 'task-1',
            },
          ]
        : [],
    );
    await wakeOrganizationParkedAgentRun(sql, 'org-1');
    expect(hinted(statements)).toBe(1);
  });
});

/** The value a flip bound to `auto_retry_armed_at_ms`, found by the column's
 * place among the statement's placeholders. */
function armedValue(
  call: { text: string; values: unknown[] } | undefined,
): unknown {
  if (call === undefined) return undefined;
  const before = call.text.slice(
    0,
    call.text.indexOf('auto_retry_armed_at_ms'),
  );
  return call.values[before.split('?').length - 1];
}

describe('a failure no retry follows is announced where it becomes final', () => {
  const failedFlip = () =>
    fakeSql((text) =>
      text.startsWith('UPDATE app.project_agent_runs')
        ? [{ organizationId: 'org-1', taskId: 'task-1', agentId: 'agent-1' }]
        : [],
    );

  beforeEach(() => {
    vi.mocked(addJobInTx).mockReset();
    vi.mocked(announceAgentRunFailed).mockReset();
    vi.mocked(recordTaskAgentRunLedgerEntry).mockReset();
  });

  it('a failure the retry cannot change is announced in the failing transaction', async () => {
    const { sql, statements, calls } = failedFlip();
    await failAgentRunFromTurn(sql, {
      runId: 'run-1',
      error: 'the organization spend cap refused the run',
      failureCode: 'budget_exceeded',
    });
    expect(addJobInTx).not.toHaveBeenCalled();
    // No retry armed, and the row says so.
    const flip = calls.find((call) =>
      call.text.startsWith('UPDATE app.project_agent_runs'),
    );
    expect(flip?.text).toContain('auto_retry_armed_at_ms = ?');
    expect(armedValue(flip)).toBeNull();
    expect(announceAgentRunFailed).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      runId: 'run-1',
    });
    expect(statements.some((text) => text.startsWith(TASK_HINT))).toBe(true);
  });

  it('a failure the platform retries is not announced: the retry is the answer', async () => {
    const { sql, statements, calls } = failedFlip();
    await failAgentRunFromTurn(sql, {
      runId: 'run-1',
      error: 'the harness crashed',
      failureCode: 'harness_error',
    });
    expect(vi.mocked(addJobInTx).mock.calls[0]?.[1]).toBe('task.agent_retry');
    // The arm is stamped on the row it continues, in the same flip.
    const flip = calls.find((call) =>
      call.text.startsWith('UPDATE app.project_agent_runs'),
    );
    expect(armedValue(flip)).toEqual(expect.any(Number));
    expect(announceAgentRunFailed).not.toHaveBeenCalled();
    expect(statements.some((text) => text.startsWith(TASK_HINT))).toBe(true);
  });

  it('a lost election announces nothing', async () => {
    const { sql } = fakeSql(() => []);
    await failAgentRunFromTurn(sql, {
      runId: 'run-1',
      error: 'late',
      failureCode: 'deadline',
    });
    expect(announceAgentRunFailed).not.toHaveBeenCalled();
  });

  it('a sweep’s fail stamps why, announces and hints', async () => {
    const { sql, calls } = fakeSql((text) =>
      text.startsWith('UPDATE app.project_agent_runs')
        ? [{ sessionId: 'pa-agent-1', taskId: 'task-1' }]
        : [],
    );
    await expect(
      failAgentRun(sql, {
        organizationId: 'org-1',
        runId: 'run-1',
        execId: 'exec-1',
        error: 'the agent run ran past its time limit and was stopped',
        failureCode: 'deadline',
      }),
    ).resolves.toBe(true);
    const update = calls.find((call) =>
      call.text.startsWith('UPDATE app.project_agent_runs'),
    );
    expect(update?.text).toContain('failure_code = ?');
    expect(update?.values).toContain('deadline');
    expect(announceAgentRunFailed).toHaveBeenCalledWith(expect.anything(), {
      organizationId: 'org-1',
      runId: 'run-1',
    });
    expect(calls.some((call) => call.text.startsWith(TASK_HINT))).toBe(true);
  });
});

describe('the run card tells a final failure from one about to be retried', () => {
  /** The card's read and the retry history behind it. */
  function cardSql(
    card: Record<string, unknown>,
    history: Record<string, unknown>[],
  ): Sql {
    return fakeSql((text) => {
      if (text.includes('LEFT JOIN app.project_agents a')) return [card];
      if (text.includes('auto_retry_refused_at_ms::float8')) return history;
      return [];
    }).sql;
  }

  const failedCard = (failureCode: string | null) => ({
    id: 'run-1',
    status: 'failed',
    agentId: 'agent-1',
    agentName: 'Content editor',
    harness: 'claude-code',
    model: 'm',
    error: 'boom',
    failureCode,
    resultText: null,
    waitingForCapacityAt: null,
    trigger: 'manual',
    autoRetryAttempt: null,
    startedBy: 'u-1',
    startedAt: 1,
    settledAt: 2,
  });

  const historyRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'run-1',
    status: 'failed',
    agentId: 'agent-1',
    startedBy: 'u-1',
    launchedAt: 1,
    settledAt: 2,
    failureCode: 'harness_error',
    apiErrorStatus: null,
    autoRetryAttempt: null,
    autoRetryRefusedAt: null,
    // The turn host's failed mark armed its retry.
    autoRetryArmedAt: 2,
    ...overrides,
  });

  it('carries the failure code and reads a retryable first failure as pending', async () => {
    const card = await getLatestAgentRunCardForTask(
      cardSql(failedCard('harness_error'), [historyRow()]),
      'org-1',
      'task-1',
    );
    expect(card).toMatchObject({
      status: 'failed',
      failureCode: 'harness_error',
      retryPending: true,
    });
  });

  it('reads a failure a retry cannot change as final', async () => {
    const card = await getLatestAgentRunCardForTask(
      cardSql(failedCard('budget_exceeded'), [
        // Its failed mark armed nothing: no retry changes a spent limit.
        historyRow({ failureCode: 'budget_exceeded', autoRetryArmedAt: null }),
      ]),
      'org-1',
      'task-1',
    );
    expect(card?.retryPending).toBeUndefined();
    expect(card?.failureCode).toBe('budget_exceeded');
  });

  it('reads a retired retry as final', async () => {
    const card = await getLatestAgentRunCardForTask(
      cardSql(failedCard('turn_crashed'), [
        historyRow({ failureCode: 'turn_crashed', autoRetryRefusedAt: 5 }),
      ]),
      'org-1',
      'task-1',
    );
    expect(card?.retryPending).toBeUndefined();
  });

  it('reads a spent budget as final', async () => {
    const spent = [0, 1, 2, 3].map((n) =>
      historyRow({
        id: n === 0 ? 'run-1' : `run-${n + 1}`,
        failureCode: 'turn_crashed',
        autoRetryAttempt: n === 3 ? null : 3 - n,
      }),
    );
    const card = await getLatestAgentRunCardForTask(
      cardSql(failedCard('turn_crashed'), spent),
      'org-1',
      'task-1',
    );
    expect(card?.retryPending).toBeUndefined();
  });

  it('reads a failure no retry was armed for as final, whatever its code says', async () => {
    // A sweep's fail, or a row failed before the mark: the code alone reads
    // retryable (absent = the default posture), but nothing is coming.
    const card = await getLatestAgentRunCardForTask(
      cardSql(failedCard(null), [
        historyRow({ failureCode: null, autoRetryArmedAt: null }),
      ]),
      'org-1',
      'task-1',
    );
    expect(card?.retryPending).toBeUndefined();
  });

  it('never reads a failure without a live agent as pending', async () => {
    const card = await getLatestAgentRunCardForTask(
      cardSql({ ...failedCard('harness_error'), agentName: null }, [
        historyRow(),
      ]),
      'org-1',
      'task-1',
    );
    expect(card?.retryPending).toBeUndefined();
  });
});
