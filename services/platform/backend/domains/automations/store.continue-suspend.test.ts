// @vitest-environment node

/**
 * Unit lock for the two doors a walker leaves a live run by: the hand-off
 * (`continueRun`) and the park (`suspendRun`). Both are ONE statement fenced
 * by the walker's epoch and a live status, and both release the walker's
 * lease — the run has no walker until the next claim.
 *
 * A hand-off queues the step that continues the run and promises a claim
 * within the claim window AFTER the step's delay, so the sweep never reads a
 * handed-off run as overdue while its step waits. A hand-off because the
 * server is stopping counts on the run and is recorded (with the node it was
 * in, and whether the node was cut off); a budget hand-off changes nothing a
 * person sees. A park takes its poll chain's next sequence from the write
 * itself, never from an earlier read.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

import { RUN_CLAIM_PROMISE_MS } from '../../core/automations/liveness.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { continueRun, suspendRun } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** Scripted transactional `sql`: the fenced run write answers `written`
 * (empty = it matched nothing). */
function fakeSql(written: Record<string, unknown>[]): {
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
    if (text.includes('UPDATE app.automation_runs')) {
      return Promise.resolve(written);
    }
    if (text.includes('INSERT INTO app.automation_run_events')) {
      return Promise.resolve([{ id: 'event_1' }]);
    }
    return Promise.resolve([]);
  };
  fn.unsafe = (text: string): { raw: string } => ({ raw: text });
  fn.json = (value: unknown): { json: unknown } => ({ json: value });
  fn.begin = (body: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
    body(fn);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for postgres.js
  return { sql: fn as unknown as Sql, statements };
}

const runWrite = (statements: Statement[]): Statement => {
  const write = statements.find((s) =>
    s.text.includes('UPDATE app.automation_runs'),
  );
  if (!write) throw new Error('no run write recorded');
  return write;
};

/** Every event the door recorded: its kind and detail. */
const events = (statements: Statement[]) =>
  statements
    .filter((s) => s.text.includes('INSERT INTO app.automation_run_events'))
    .map((s) => ({
      kind: s.values[3],
      detail: (s.values[6] as { json: unknown } | null)?.json,
    }));

function expectFenced(write: Statement): void {
  expect(write.text).toContain('AND claim_epoch = ?');
  expect(write.text).toContain(
    "AND status IN ('queued', 'running', 'waiting')",
  );
  expect(write.text).toContain(
    'lease_owner = NULL, lease_expires_at_ms = NULL',
  );
  expect(write.values).toEqual(expect.arrayContaining(['run_1', 'org_1', 7]));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('continueRun', () => {
  const hand = (
    sql: Sql,
    extra: Partial<Parameters<typeof continueRun>[1]> = {},
  ) =>
    continueRun(sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      epoch: 7,
      resumeInMs: 0,
      ...extra,
    });

  it('releases the lease and queues the next turn, promising its claim after the delay', async () => {
    const before = Date.now();
    const fake = fakeSql([{ id: 'run_1' }]);
    await expect(hand(fake.sql, { resumeInMs: 5_000 })).resolves.toEqual({
      scheduled: true,
    });
    const write = runWrite(fake.statements);
    expectFenced(write);
    // Never born overdue: the promise covers the step's delay and its claim.
    expect(write.values[0]).toBeGreaterThanOrEqual(
      before + 5_000 + RUN_CLAIM_PROMISE_MS,
    );
    expect(addJobInTx).toHaveBeenCalledWith(
      fake.sql,
      'automation.step',
      { organizationId: 'org_1', runId: 'run_1' },
      { startAfter: expect.any(Date) },
    );
  });

  it('keeps a budget hand-off silent: nothing counted, recorded or announced', async () => {
    const fake = fakeSql([{ id: 'run_1' }]);
    await hand(fake.sql);
    const write = runWrite(fake.statements);
    expect(write.values).toContain(0);
    expect(write.values).toContain(false);
    expect(write.values).not.toContain(true);
    expect(events(fake.statements)).toEqual([]);
    expect(emitHintInTx).not.toHaveBeenCalled();
    // An immediate hand-off queues its step at once.
    expect(addJobInTx).toHaveBeenCalledWith(
      fake.sql,
      'automation.step',
      { organizationId: 'org_1', runId: 'run_1' },
      {},
    );
  });

  it('counts and records a hand-off because the server is stopping', async () => {
    const fake = fakeSql([{ id: 'run_1' }]);
    await hand(fake.sql, {
      handoff: {
        reason: 'shutdown',
        nodeId: 'send',
        itemIndex: 4,
        interrupted: true,
      },
    });
    const write = runWrite(fake.statements);
    expect(write.text).toContain("THEN 'shutdown' ELSE last_resume_reason");
    expect(write.values).toContain(1);
    expect(write.values).toContain(true);
    expect(events(fake.statements)).toEqual([
      {
        kind: 'handed_off',
        detail: { reason: 'shutdown', nodeId: 'send', itemIndex: 4 },
      },
      { kind: 'node_interrupted', detail: { nodeId: 'send', itemIndex: 4 } },
    ]);
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });

  it('records no interruption for a node that finished before the hand-off', async () => {
    const fake = fakeSql([{ id: 'run_1' }]);
    await hand(fake.sql, { handoff: { reason: 'shutdown' } });
    expect(events(fake.statements)).toEqual([
      { kind: 'handed_off', detail: { reason: 'shutdown' } },
    ]);
  });

  it('queues nothing when the walker no longer holds a live run', async () => {
    const fake = fakeSql([]);
    await expect(
      hand(fake.sql, { handoff: { reason: 'shutdown' } }),
    ).resolves.toEqual({ scheduled: false });
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(events(fake.statements)).toEqual([]);
    expect(emitHintInTx).not.toHaveBeenCalled();
  });
});

describe('suspendRun', () => {
  const park = (
    sql: Sql,
    extra: Partial<Parameters<typeof suspendRun>[1]> = {},
  ) =>
    suspendRun(sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      epoch: 7,
      detail: 'approval:appr_1',
      cursor: { node: 'send', index: 0, passes: 0, outs: [] },
      executions: 3,
      resumeInMs: 30_000,
      ...extra,
    });

  it('parks the run, releases the lease and chains the poll on the sequence it wrote', async () => {
    const fake = fakeSql([{ seq: 12 }]);
    await expect(park(fake.sql)).resolves.toEqual({ suspended: true });
    const write = runWrite(fake.statements);
    expectFenced(write);
    expect(write.text).toContain("status = 'waiting'");
    expect(write.text).toContain('chain_seq = chain_seq + 1');
    expect(write.text).toContain('RETURNING chain_seq AS seq');
    // Keys the engine does not know survive; the cursor is replaced.
    expect(write.text).toContain("checkpoints - 'cursor'");
    expect(addJobInTx).toHaveBeenCalledWith(
      fake.sql,
      'automation.poll',
      { organizationId: 'org_1', runId: 'run_1', seq: 12, pollMs: 30_000 },
      { startAfter: expect.any(Date) },
    );
    expect(events(fake.statements)).toEqual([]);
    expect(emitHintInTx).toHaveBeenCalledTimes(1);
  });

  it('records why it parked when the caller says so', async () => {
    const fake = fakeSql([{ seq: 2 }]);
    await park(fake.sql, {
      detail: 'in_doubt:send',
      event: {
        kind: 'in_doubt',
        detail: { path: 'send', itemIndex: 0, pass: 0, attemptId: 'att_1' },
      },
    });
    expect(events(fake.statements)).toEqual([
      {
        kind: 'in_doubt',
        detail: { path: 'send', itemIndex: 0, pass: 0, attemptId: 'att_1' },
      },
    ]);
  });

  it('parks nothing and chains no poll when the walker no longer holds a live run', async () => {
    const fake = fakeSql([]);
    await expect(park(fake.sql)).resolves.toEqual({ suspended: false });
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(emitHintInTx).not.toHaveBeenCalled();
  });
});
