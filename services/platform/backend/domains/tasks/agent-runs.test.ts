import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { cancelAgentRunInTx, wakeParkedAgentRuns } from './agent-runs.ts';
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

describe('wakeParkedAgentRuns — the deadline lane owns a parked run past its deadline', () => {
  /** A `sql` whose `begin` runs the callback against the scripted tx. */
  function fakeSql(answer: (text: string) => Row[]): {
    sql: Sql;
    statements: string[];
  } {
    const { tx, statements } = fakeTx(answer);
    const begin = (cb: (tx: TransactionSql) => Promise<unknown>) => cb(tx);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for postgres.js `sql.begin`
    return { sql: { begin } as unknown as Sql, statements };
  }

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
