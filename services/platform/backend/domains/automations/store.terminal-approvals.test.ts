// @vitest-environment node

/**
 * Unit lock for the terminal doors' approval close (dead-end class): the
 * gate mints one pending `connector_operation` card per gated live node,
 * keyed by `metadata.runId`. Nothing moved such a card once its run ended —
 * a decision only pokes a WAITING run — so cancelling a run parked on
 * approval kept an actionable card whose approval then sat at `executing`
 * forever. Both doors (cancel and finish) now withdraw the run's open cards
 * in the same transaction. The real-Postgres probe proves the predicate
 * against the schema; this pins the write's shape and its presence on both
 * doors.
 */

import type { PgBoss } from 'pg-boss';
import type { Sql, TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setEnqueueBoss } from '../../jobs/enqueue.ts';

const { createAuditLog } = vi.hoisted(() => ({
  createAuditLog: vi.fn(async () => 'audit_1'),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));

import { cancelRunInTx, finishRun } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(runRow: Record<string, unknown>): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('UPDATE app.approvals')) {
      return Promise.resolve([{ id: 'appr_1' }, { id: 'appr_2' }]);
    }
    if (text.includes('app.automation_runs')) return Promise.resolve([runRow]);
    return Promise.resolve([]);
  };
  fn.unsafe = (text: string): { raw: string } => ({ raw: text });
  fn.json = (value: unknown): { json: unknown } => ({ json: value });
  fn.begin = (body: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
    body(fn);
  return { sql: fn as unknown as Sql, statements };
}

const runRow = {
  id: 'run_1',
  organizationId: 'org_1',
  name: 'ops/send',
  version: 1,
  status: 'waiting',
  mode: 'mock',
  startedBy: 'user_1',
  checkpoints: { nodes: {}, executions: 1 },
  claimEpoch: 1,
  chainSeq: 0,
};

beforeEach(() => {
  createAuditLog.mockClear();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- capture stub; nothing here enqueues, but the doors share the module
  setEnqueueBoss({
    send: () => Promise.resolve('job-id'),
  } as unknown as PgBoss);
});

afterEach(() => {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- reset the module-level boss between tests
  setEnqueueBoss(null as unknown as PgBoss);
});

function approvalClose(statements: Statement[]): Statement {
  const close = statements.find((s) => s.text.includes('UPDATE app.approvals'));
  if (!close) throw new Error('the door did not touch app.approvals');
  return close;
}

function expectWithdrawal(statements: Statement[]): void {
  const close = approvalClose(statements);
  expect(close.text).toContain("status = 'rejected'");
  expect(close.text).toContain("resource_type = 'connector_operation'");
  // Open cards only — a pending one and an approved-but-unconsumed one.
  expect(close.text).toContain("status IN ('pending', 'executing')");
  expect(close.text).toContain("metadata->>'runId' = ?");
  expect(close.values).toContainEqual({
    json: { withdrawn: true, withdrawnBy: 'run_terminal' },
  });
  expect(close.values).toContain('org_1');
  expect(close.values).toContain('run_1');
  // Every closed card gets its own realtime hint, like a human decision.
  const hints = statements.filter(
    (s) =>
      s.text.includes('app_realtime.outbox') && s.values.includes('approval'),
  );
  expect(hints.map((s) => s.values[3])).toEqual(['appr_1', 'appr_2']);
}

describe('the terminal doors withdraw the run’s open approvals', () => {
  it('cancelRun', async () => {
    const fake = fakeSql(runRow);
    const result = await cancelRunInTx(
      fake.sql as unknown as TransactionSql,
      'org_1',
      'run_1',
    );
    expect(result).toEqual({ cancelled: true, status: 'cancelled' });
    expectWithdrawal(fake.statements);
  });

  it('finishRun', async () => {
    const fake = fakeSql(runRow);
    const result = await finishRun(fake.sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      epoch: 1,
      status: 'failed',
      trace: [],
      effects: [],
      detail: 'an upstream node failed',
      executions: 1,
    });
    expect(result).toEqual({ status: 'failed' });
    expectWithdrawal(fake.statements);
  });
});

/**
 * The stop's audit row names the person who stopped the run. It used to
 * name the run's STARTER as `system`, so a stop by a colleague read as the
 * starter's own doing (2026-09-26 evaluation, D-07). The count of approvals
 * the stop withdrew rides on the row, since the run's own park string is
 * cleared by the cancel.
 */
describe('the cancel audit row', () => {
  it('names the acting user and the approvals the stop withdrew', async () => {
    const fake = fakeSql({ ...runRow, mode: 'live', startedBy: 'user:u_1' });
    await cancelRunInTx(
      fake.sql as unknown as TransactionSql,
      'org_1',
      'run_1',
      'u_2',
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      fake.sql,
      expect.objectContaining({
        actorId: 'u_2',
        actorType: 'user',
        action: 'automation.run.cancelled',
        resourceId: 'run_1',
        metadata: { approvalsWithdrawn: 2 },
      }),
    );
  });

  it('falls back to the starter as `system` when nobody asked for the stop', async () => {
    const fake = fakeSql({ ...runRow, mode: 'live', startedBy: 'user:u_1' });
    await cancelRunInTx(
      fake.sql as unknown as TransactionSql,
      'org_1',
      'run_1',
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      fake.sql,
      expect.objectContaining({ actorId: 'user:u_1', actorType: 'system' }),
    );
  });
});
