import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  cancelAgentRunInTx,
  failAgentRunFromTurn,
  kickAgentRun,
  launchAgentRun,
  settleAgentRun,
  wakeParkedAgentRuns,
} from './agent-runs.ts';
import { recordTaskAgentRunLedgerEntry } from './run-ledger.ts';

vi.mock('./run-ledger.ts', () => ({ recordTaskAgentRunLedgerEntry: vi.fn() }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));

type Row = Record<string, unknown>;

/** A postgres.js tagged-template stand-in answering each statement from its
 * (whitespace-collapsed) text; the statements are what these tests pin. */
function fakeTx(answer: (text: string) => Row[]): {
  tx: TransactionSql;
  statements: string[];
} {
  const statements: string[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<Row[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    return Promise.resolve(answer(text));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js template function
  return { tx: tag as unknown as TransactionSql, statements };
}

const KEYS = { organizationId: 'org-1', runId: 'run-1', taskId: 'task-1' };

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
      text.startsWith('UPDATE app.project_agent_runs') ? [{ id: 'run-1' }] : [],
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
  });
});

/** A root `sql` stand-in whose `begin` hands the callback the same tagged
 * template — the terminal marks open their own transaction. */
function fakeSql(answer: (text: string) => Row[]): {
  sql: Sql;
  statements: string[];
} {
  const { tx, statements } = fakeTx(answer);
  const sql = Object.assign(tx, {
    begin: (callback: (tx: TransactionSql) => unknown): unknown => callback(tx),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a two-member stand-in for the postgres.js root instance
  return { sql: sql as unknown as Sql, statements };
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

describe('launchAgentRun — the running flip is exec-fenced', () => {
  it('flips only a QUEUED run still owned by this exec, and says so', async () => {
    const { tx, statements } = fakeTx((text) =>
      text.startsWith('UPDATE app.project_agent_runs') ? [{ id: 'run-1' }] : [],
    );
    // A root sql and a tx share the tagged-template shape; the flip takes
    // the root handle in production.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same one-member stand-in
    const sql = tx as unknown as Sql;
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
    expect(update).toContain('RETURNING id');
  });

  it('a start under a rotated-away exec loses the launch', async () => {
    const { tx } = fakeTx(() => []);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- same one-member stand-in
    const sql = tx as unknown as Sql;
    await expect(
      launchAgentRun(sql, { runId: 'run-1', execId: 'exec-stale' }),
    ).resolves.toBe(false);
  });
});

describe('kickAgentRun — one live run per task is the schema’s rule', () => {
  beforeEach(() => {
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

  it('inserts under the live-run unique index and enqueues the turn on a win', async () => {
    const { tx, statements } = fakeTx((text) =>
      text.startsWith('INSERT INTO app.project_agent_runs')
        ? [{ id: 'run-new' }]
        : [],
    );
    const result = await kickAgentRun(tx, kick);
    expect(result.reused).toBe(false);
    expect(result.runId).toBe('run-new');
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
    const claim = statements.find((text) =>
      text.startsWith(
        'SELECT id, exec_id AS "execId" FROM app.project_agent_runs',
      ),
    );
    expect(claim).toBeDefined();
    expect(claim).toContain("status = 'queued'");
    expect(claim).toContain('waiting_for_capacity_at_ms IS NOT NULL');
    expect(claim).toContain('deadline_at_ms > ?');
    expect(claim).toContain('FOR UPDATE SKIP LOCKED');
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('un-parks the claimed run and re-enqueues its turn in the same transaction', async () => {
    const { sql, statements } = fakeSql((text) =>
      text.startsWith('SELECT id, exec_id AS "execId"')
        ? [{ id: 'run-1', execId: 'exec-1' }]
        : [],
    );
    const woken = await wakeParkedAgentRuns(sql, 'org-1');
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
