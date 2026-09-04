import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { cancelAgentRunInTx } from './agent-runs.ts';
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
