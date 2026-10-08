// @vitest-environment node

/**
 * Unit lock for the terminal door's trigger bookkeeping: `finishRun` hands
 * every LIVE run it lands to the trigger failure streak
 * (`trigger-failures.ts`) inside the same transaction as the run's own
 * write and audit row, and emits the `automation` hint when the trigger's
 * read changed — so an open Trigger section shows the streak or the pause
 * without a reload. A mock run never touches a trigger. The streak is kept
 * AFTER the run's audit row: the organization's audit chain is locked ahead
 * of any trigger row, here as in an event dispatch, so a finish and a
 * producer stamping the same trigger queue on the chain instead of
 * deadlocking (`trigger-lock-order.integration.ts` proves it on Postgres).
 *
 * The terminal write itself is ONE statement fenced by the walker's epoch
 * and a live status, so a stop that committed first wins: the finish then
 * changes nothing and writes nothing else — no audit row, no trigger
 * outcome, no second close of what the stop already closed.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog, recordTriggerRunOutcome } = vi.hoisted(() => ({
  createAuditLog: vi.fn(async () => 'audit_1'),
  recordTriggerRunOutcome: vi.fn(
    async (): Promise<{ name: string; paused: boolean } | null> => null,
  ),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('./trigger-failures.ts', () => ({ recordTriggerRunOutcome }));

import { finishRun } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
  inTx: boolean;
}

/** `fenced`: whether the fenced terminal write matches nothing — by default
 * when the run already ended; a superseded claim on a live run is the other
 * case. */
function fakeSql(
  row: Record<string, unknown>,
  fenced = !['queued', 'running', 'waiting'].includes(String(row.status)),
): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  let depth = 0;
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push({ text, values, inTx: depth > 0 });
    // The terminal write is fenced by a live status: a run that already
    // landed matches nothing, and the read after it says why.
    if (text.includes('UPDATE app.automation_runs')) {
      return Promise.resolve(fenced ? [] : [row]);
    }
    return Promise.resolve(
      text.includes('FROM app.automation_runs') ? [row] : [],
    );
  };
  fn.unsafe = (text: string): { raw: string } => ({ raw: text });
  fn.json = (value: unknown): { json: unknown } => ({ json: value });
  fn.begin = async (body: (tx: unknown) => Promise<unknown>) => {
    depth++;
    try {
      return await body(fn);
    } finally {
      depth--;
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for postgres.js
  return { sql: fn as unknown as Sql, statements };
}

const runRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'run_1',
  organizationId: 'org_1',
  name: 'ops/nightly',
  version: 3,
  status: 'running',
  mode: 'live',
  startedBy: 'trigger:trg_1',
  startedAt: 1_000,
  checkpoints: { nodes: {}, executions: 1 },
  claimEpoch: 1,
  chainSeq: 0,
  ...overrides,
});

const finish = (
  sql: Sql,
  args: Partial<Parameters<typeof finishRun>[1]> = {},
) =>
  finishRun(sql, {
    organizationId: 'org_1',
    runId: 'run_1',
    epoch: 1,
    status: 'failed',
    trace: [],
    effects: [],
    detail: 'boom: deliberate',
    failureCode: 'node_error',
    executions: 1,
    ...args,
  });

/** The `automation` definition hints written to the realtime outbox. */
const definitionHints = (statements: Statement[]) =>
  statements.filter(
    (s) =>
      s.text.includes('INSERT INTO app_realtime.outbox') &&
      s.values.includes('automation'),
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('finishRun — the trigger failure streak', () => {
  it('hands a failed live run to the streak, in the terminal transaction', async () => {
    const fake = fakeSql(runRow());
    await finish(fake.sql);
    expect(recordTriggerRunOutcome).toHaveBeenCalledTimes(1);
    expect(recordTriggerRunOutcome).toHaveBeenCalledWith(fake.sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      startedBy: 'trigger:trg_1',
      startedAt: 1_000,
      status: 'failed',
      failureCode: 'node_error',
      now: expect.any(Number),
    });
    // Nothing changed on the trigger: no definition hint.
    expect(definitionHints(fake.statements)).toEqual([]);
  });

  it.each([
    ['failed', 'node_error'],
    ['success', null],
  ] as const)(
    'writes the run audit row (the audit chain) before a %s run touches the trigger row',
    async (status, failureCode) => {
      const fake = fakeSql(runRow());
      await finish(fake.sql, { status, failureCode });
      const [auditedAt] = createAuditLog.mock.invocationCallOrder;
      const [keptAt] = recordTriggerRunOutcome.mock.invocationCallOrder;
      expect(auditedAt).toBeDefined();
      expect(keptAt).toBeDefined();
      expect(auditedAt).toBeLessThan(keptAt ?? 0);
      // And nothing reads or writes a trigger row ahead of the audit row.
      expect(
        fake.statements.filter((s) =>
          s.text.includes('app.automation_triggers'),
        ),
      ).toEqual([]);
    },
  );

  it('hands a success over with no failure code', async () => {
    const fake = fakeSql(runRow());
    await finish(fake.sql, {
      status: 'success',
      output: { ok: true },
      failureCode: 'node_error',
    });
    expect(recordTriggerRunOutcome).toHaveBeenCalledWith(
      fake.sql,
      expect.objectContaining({ status: 'success', failureCode: null }),
    );
  });

  it('refreshes the automation read when the trigger changed', async () => {
    recordTriggerRunOutcome.mockResolvedValueOnce({
      name: 'ops/nightly',
      paused: true,
    });
    const fake = fakeSql(runRow());
    await finish(fake.sql);
    const hints = definitionHints(fake.statements);
    expect(hints).toHaveLength(1);
    expect(hints[0]?.values).toEqual([
      'org_1',
      null,
      'automation',
      'ops/nightly',
    ]);
    expect(hints[0]?.inTx).toBe(true);
  });

  it('leaves triggers alone for a mock run [AUTO-R13]', async () => {
    const fake = fakeSql(runRow({ mode: 'mock', startedBy: 'user:u_1' }));
    await finish(fake.sql);
    expect(recordTriggerRunOutcome).not.toHaveBeenCalled();
  });

  it('leaves triggers alone when the run already landed', async () => {
    const fake = fakeSql(runRow({ status: 'failed' }));
    await expect(finish(fake.sql)).resolves.toEqual({ status: 'failed' });
    expect(recordTriggerRunOutcome).not.toHaveBeenCalled();
  });
});

describe('finishRun — a stop that committed first wins', () => {
  it('lands nothing and writes nothing else once the run was stopped [AUTO-R17]', async () => {
    // Ada pressed Stop as the last step finished: the cancel committed, and
    // the walker's finish arrives second.
    const fake = fakeSql(runRow({ status: 'cancelled' }));
    await expect(finish(fake.sql, { status: 'success' })).resolves.toEqual({
      status: 'cancelled',
    });
    const [write] = fake.statements;
    expect(write?.text).toContain('UPDATE app.automation_runs');
    expect(write?.text).toContain('AND claim_epoch = ?');
    expect(write?.text).toContain(
      "AND status IN ('queued', 'running', 'waiting')",
    );
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(recordTriggerRunOutcome).not.toHaveBeenCalled();
    // Only the fenced write and the read that explains it: no session stop,
    // no approval or question closed, no hint.
    expect(fake.statements.map((s) => s.text.trim().split(/\s+/)[0])).toEqual([
      'UPDATE',
      'SELECT',
    ]);
  });

  it('answers stale to a walker whose claim was superseded, and lands nothing', async () => {
    // Another walker claimed the run after this one: the row is live under
    // a newer epoch.
    const fake = fakeSql(runRow({ claimEpoch: 2 }), true);
    await expect(finish(fake.sql)).resolves.toEqual({ status: 'stale' });
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(recordTriggerRunOutcome).not.toHaveBeenCalled();
  });
});
