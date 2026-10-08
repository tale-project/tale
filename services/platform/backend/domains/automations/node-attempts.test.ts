// @vitest-environment node

/**
 * Unit lock for the effect ledger's store half: what a walker learns when it
 * begins a call that reaches outside the run, how it records the outcome,
 * and how a person's decision about a write that may already have happened
 * lands.
 *
 * The begin share-locks the run row at the walker's epoch first, so a stale
 * walker inserts nothing. A fresh call inserts a `started` row and goes. An
 * earlier attempt decides otherwise: `done` is reused, `failed` replayed, a
 * `started` row nobody decided is called again only when the call is
 * re-callable and is in doubt otherwise; a person's retry, skip or fail is
 * honoured. The outcome is recorded whoever holds the run now. A decision
 * locks the run row before the attempt and the audit chain, the order the
 * terminal doors take. The real-Postgres probe races two begins.
 */

import type { Sql, TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAuditLog } = vi.hoisted(() => ({
  createAuditLog: vi.fn(async () => 'audit_1'),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

import { addJobInTx } from '../../jobs/enqueue.ts';
import { instanceId } from '../../lib/instance.ts';
import {
  type BeginAttemptArgs,
  beginNodeAttempt,
  finishNodeAttempt,
  readOpenInDoubt,
  resolveInDoubtInTx,
} from './node-attempts.ts';

interface Statement {
  text: string;
  values: unknown[];
}

type Answer = (text: string, values: unknown[]) => unknown[] | undefined;

/** Scripted `sql`: the first matching answer wins, anything else is empty. */
function fakeSql(answer: Answer): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push({ text, values });
    return Promise.resolve(answer(text, values) ?? []);
  };
  fn.unsafe = (text: string): { raw: string } => ({ raw: text });
  fn.json = (value: unknown): { json: unknown } => ({ json: value });
  fn.begin = (body: (tx: unknown) => Promise<unknown>): Promise<unknown> =>
    body(fn);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for postgres.js
  return { sql: fn as unknown as Sql, statements };
}

const call: BeginAttemptArgs = {
  organizationId: 'org_1',
  runId: 'run_1',
  epoch: 5,
  nodeId: 'send',
  itemIndex: 2,
  pass: 0,
  kind: 'connector',
  nodeType: 'connector',
  input: { to: 'mia@example.com' },
  recallable: false,
};

/** A begin whose run fence holds and whose insert meets `existing`. */
function beginFake(existing: Record<string, unknown> | null, again = 2) {
  return fakeSql((text) => {
    if (text.includes('FROM app.automation_runs')) return [{ id: 'run_1' }];
    if (text.includes('INSERT INTO app.automation_node_attempts')) {
      return existing === null ? [{ attempt: 1 }] : [];
    }
    if (text.includes('FROM app.automation_node_attempts')) {
      return existing === null ? [] : [existing];
    }
    if (text.includes('attempt = attempt + 1')) return [{ attempt: again }];
    return undefined;
  });
}

const attempt = (overrides: Record<string, unknown> = {}) => ({
  id: 'att_1',
  attempt: 1,
  status: 'started',
  output: null,
  error: null,
  failureCode: null,
  resolution: null,
  resolvedBy: null,
  ...overrides,
});

const statementWith = (statements: Statement[], fragment: string) =>
  statements.find((s) => s.text.includes(fragment));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('beginNodeAttempt', () => {
  it('goes for a fresh call: a started row, fenced by the run at the walker’s epoch', async () => {
    const fake = beginFake(null);
    await expect(beginNodeAttempt(fake.sql, call)).resolves.toEqual({
      kind: 'go',
      attempt: 1,
    });
    const [fence, insert] = fake.statements;
    expect(fence?.text).toContain('FOR SHARE');
    expect(fence?.text).toContain("AND claim_epoch = ? AND status = 'running'");
    expect(fence?.values.slice(0, 4)).toEqual(['run_1', 'org_1', 5, 5]);
    expect(insert?.text).toContain(
      'ON CONFLICT (run_id, node_id, item_index, pass) DO NOTHING',
    );
    expect(insert?.text).toContain("'started'");
    expect(insert?.values).toEqual(
      expect.arrayContaining(['send', 2, 0, 'connector', instanceId(), 5]),
    );
    expect(insert?.values).toContainEqual({
      json: JSON.stringify({ to: 'mia@example.com' }),
    });
  });

  it('inserts nothing for a walker that no longer holds the run', async () => {
    const fake = fakeSql(() => undefined);
    await expect(beginNodeAttempt(fake.sql, call)).resolves.toEqual({
      kind: 'stale',
    });
    expect(
      statementWith(
        fake.statements,
        'INSERT INTO app.automation_node_attempts',
      ),
    ).toBeUndefined();
  });

  it('starts nothing for a walker whose own lease lapsed, before anyone took the run over [AUTO-R19]', async () => {
    // Ada's walker stalled on a slow database for longer than its lease: a
    // write it began now would be found open, and parked, by the walker
    // that takes the run over next.
    const before = Date.now();
    const fake = fakeSql(() => undefined);
    await expect(beginNodeAttempt(fake.sql, call)).resolves.toEqual({
      kind: 'stale',
    });
    const [fence] = fake.statements;
    expect(fence?.text).toContain(
      'AND lease_epoch = ? AND lease_expires_at_ms > ?',
    );
    expect(fence?.values[3]).toBe(5);
    expect(fence?.values[4]).toBeGreaterThanOrEqual(before);
    expect(
      statementWith(
        fake.statements,
        'INSERT INTO app.automation_node_attempts',
      ),
    ).toBeUndefined();
  });

  it('reuses the output of an attempt that finished, and calls nothing', async () => {
    const fake = beginFake(
      attempt({ status: 'done', output: { id: 'inv_9' } }),
    );
    await expect(beginNodeAttempt(fake.sql, call)).resolves.toEqual({
      kind: 'done',
      output: { id: 'inv_9' },
    });
    expect(
      statementWith(fake.statements, 'FROM app.automation_node_attempts')?.text,
    ).toContain('FOR UPDATE');
  });

  it('replays the failure an attempt recorded', async () => {
    const fake = beginFake(
      attempt({
        status: 'failed',
        error: 'the mailbox refused it',
        failureCode: 'connector_error',
      }),
    );
    await expect(beginNodeAttempt(fake.sql, call)).resolves.toEqual({
      kind: 'failed',
      error: 'the mailbox refused it',
      failureCode: 'connector_error',
    });
  });

  it('is in doubt about a write nobody finished and nobody decided', async () => {
    const fake = beginFake(attempt({ attempt: 3 }));
    await expect(beginNodeAttempt(fake.sql, call)).resolves.toEqual({
      kind: 'in_doubt',
      attemptId: 'att_1',
      attempt: 3,
    });
    expect(
      statementWith(fake.statements, 'attempt = attempt + 1'),
    ).toBeUndefined();
  });

  it('calls a re-callable call again, as the next attempt of this walker', async () => {
    const fake = beginFake(attempt(), 2);
    await expect(
      beginNodeAttempt(fake.sql, { ...call, kind: 'llm', recallable: true }),
    ).resolves.toEqual({ kind: 'go', attempt: 2 });
    const again = statementWith(fake.statements, 'attempt = attempt + 1');
    expect(again?.text).toContain('resolution = NULL');
    expect(again?.values).toEqual(
      expect.arrayContaining([instanceId(), 5, 'att_1']),
    );
  });

  it('runs it again when a person chose to', async () => {
    const fake = beginFake(attempt({ resolution: 'retry' }), 2);
    await expect(beginNodeAttempt(fake.sql, call)).resolves.toEqual({
      kind: 'go',
      attempt: 2,
    });
  });

  it('skips it when a person chose to: the attempt is done with no output', async () => {
    const fake = beginFake(attempt({ resolution: 'skip' }));
    await expect(beginNodeAttempt(fake.sql, call)).resolves.toEqual({
      kind: 'skip',
    });
    const skipped = statementWith(fake.statements, "status = 'done'");
    expect(skipped?.text).toContain('output = NULL');
    expect(skipped?.values).toContain('att_1');
  });

  it('fails the run when a person chose to, naming them', async () => {
    const fake = beginFake(
      attempt({ resolution: 'fail', resolvedBy: 'u_mia' }),
    );
    await expect(beginNodeAttempt(fake.sql, call)).resolves.toEqual({
      kind: 'fail',
      resolvedBy: 'u_mia',
    });
  });
});

describe('finishNodeAttempt', () => {
  it('records the outcome of the attempt it began, fenced by nothing but that attempt', async () => {
    const fake = fakeSql(() => [{ id: 'att_1' }]);
    await expect(
      finishNodeAttempt(fake.sql, {
        organizationId: 'org_1',
        runId: 'run_1',
        nodeId: 'send',
        itemIndex: 2,
        pass: 0,
        attempt: 1,
        status: 'done',
        output: 'sent',
      }),
    ).resolves.toEqual({ recorded: true });
    const [write] = fake.statements;
    expect(write?.text).not.toContain('claim_epoch');
    expect(write?.text).toContain('AND attempt = ?');
    expect(write?.text).toContain("AND status = 'started'");
    // A bare string output is stored as a JSON string.
    expect(write?.values).toContainEqual({ json: '"sent"' });
  });

  it('records a failure without an output', async () => {
    const fake = fakeSql(() => []);
    await expect(
      finishNodeAttempt(fake.sql, {
        organizationId: 'org_1',
        runId: 'run_1',
        nodeId: 'send',
        itemIndex: 0,
        pass: 1,
        attempt: 2,
        status: 'failed',
        output: { ignored: true },
        error: 'refused',
        failureCode: 'connector_error',
      }),
    ).resolves.toEqual({ recorded: false });
    const [write] = fake.statements;
    expect(write?.values.slice(0, 4)).toEqual([
      'failed',
      null,
      'refused',
      'connector_error',
    ]);
  });
});

describe('finishNodeAttempt — a write that ends after its run was parked on it', () => {
  const finish = (sql: Sql) =>
    finishNodeAttempt(sql, {
      organizationId: 'org_1',
      runId: 'run_1',
      nodeId: 'send',
      itemIndex: 2,
      pass: 0,
      attempt: 1,
      status: 'done',
      output: { id: 'inv_9' },
    });

  it('wakes the run, so it reads the end instead of waiting for a person [AUTO-R19]', async () => {
    // Mia's invoice was still being sent when its walker's lease lapsed;
    // the walker that took the run over parked it on the send. The send
    // then came back.
    const fake = fakeSql((text) => {
      if (text.includes('UPDATE app.automation_node_attempts')) {
        return [{ id: 'att_1', kind: 'connector' }];
      }
      if (text.includes('UPDATE app.automation_runs')) return [{ id: 'run_1' }];
      return undefined;
    });
    await expect(finish(fake.sql)).resolves.toEqual({ recorded: true });
    const wake = statementWith(fake.statements, 'UPDATE app.automation_runs');
    expect(wake?.text).toContain(
      "AND status = 'waiting' AND detail LIKE 'in_doubt:%'",
    );
    expect(wake?.text).toContain('AND NOT EXISTS (');
    expect(wake?.text).toContain(
      "AND kind = 'connector' AND status = 'started'",
    );
    expect(addJobInTx).toHaveBeenCalledWith(
      fake.sql,
      'automation.step',
      { organizationId: 'org_1', runId: 'run_1' },
      {},
    );
  });

  it('leaves a run that is not parked on it alone', async () => {
    const fake = fakeSql((text) =>
      text.includes('UPDATE app.automation_node_attempts')
        ? [{ id: 'att_1', kind: 'connector' }]
        : undefined,
    );
    await expect(finish(fake.sql)).resolves.toEqual({ recorded: true });
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('does not look at the run for a model call', async () => {
    const fake = fakeSql((text) =>
      text.includes('UPDATE app.automation_node_attempts')
        ? [{ id: 'att_1', kind: 'llm' }]
        : undefined,
    );
    await finish(fake.sql);
    expect(
      statementWith(fake.statements, 'UPDATE app.automation_runs'),
    ).toBeUndefined();
  });

  it('keeps the recorded end when the wake cannot be queued, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(addJobInTx).mockRejectedValueOnce(new Error('queue closing'));
    const fake = fakeSql((text) => {
      if (text.includes('UPDATE app.automation_node_attempts')) {
        return [{ id: 'att_1', kind: 'connector' }];
      }
      if (text.includes('UPDATE app.automation_runs')) return [{ id: 'run_1' }];
      return undefined;
    });
    await expect(finish(fake.sql)).resolves.toEqual({ recorded: true });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('readOpenInDoubt', () => {
  it('reads the undecided write only while the run is parked on it', async () => {
    const open = {
      attemptId: 'att_1',
      nodeId: 'send',
      itemIndex: 2,
      pass: 0,
      attempt: 1,
      kind: 'connector',
      nodeType: 'connector',
      input: { to: 'mia@example.com' },
      startedAt: 1_000,
    };
    const fake = fakeSql(() => [open]);
    await expect(readOpenInDoubt(fake.sql, 'org_1', 'run_1')).resolves.toEqual(
      open,
    );
    const [read] = fake.statements;
    expect(read?.text).toContain(
      "r.status = 'waiting' AND r.detail LIKE 'in_doubt:%'",
    );
    expect(read?.text).toContain(
      "a.status = 'started' AND a.resolution IS NULL",
    );
    expect(read?.text).toContain("a.kind = 'connector'");

    const none = fakeSql(() => []);
    await expect(
      readOpenInDoubt(none.sql, 'org_1', 'run_1'),
    ).resolves.toBeNull();
  });
});

describe('resolveInDoubtInTx', () => {
  const decide = (
    sql: Sql,
    resolution: 'retry' | 'skip' | 'fail' = 'skip',
    about = 1,
  ) =>
    resolveInDoubtInTx(sql as unknown as TransactionSql, {
      organizationId: 'org_1',
      runId: 'run_1',
      attemptId: 'att_1',
      attempt: about,
      resolution,
      actor: 'u_mia',
    });

  /** The attempt number a statement binds after `AND attempt =`, if any. */
  function boundAttempt(text: string, values: unknown[]): unknown {
    const at = text
      .split('?')
      .findIndex((part) => part.trimEnd().endsWith('AND attempt ='));
    return at === -1 ? undefined : values[at];
  }

  /** `rowAttempt` is the number the attempt row holds now: like the table,
   * the update matches it unless the statement binds another number. */
  function decisionFake(
    run: Record<string, unknown> | null,
    resolved = true,
    rowAttempt = 1,
  ) {
    return fakeSql((text, values) => {
      if (text.includes('FROM app.automation_runs')) {
        return run === null ? [] : [run];
      }
      if (text.includes('UPDATE app.automation_node_attempts')) {
        const bound = boundAttempt(text, values);
        return resolved && (bound === undefined || bound === rowAttempt)
          ? [{ nodeId: 'send', itemIndex: 2, pass: 0 }]
          : [];
      }
      if (text.includes('UPDATE app.automation_runs')) return [{ id: 'run_1' }];
      if (text.includes('INSERT INTO app.automation_run_events')) {
        return [{ id: 'event_1' }];
      }
      return undefined;
    });
  }

  const inDoubtRun = (mode: 'live' | 'mock') => ({
    status: 'waiting',
    detail: 'in_doubt:send',
    mode,
    name: 'billing/invoices',
    version: 4,
  });

  it('locks the run, then the attempt, then the audit chain, and wakes the run', async () => {
    const fake = decisionFake(inDoubtRun('live'));
    await decide(fake.sql, 'retry');
    const order = fake.statements.map((s) =>
      s.text.includes('FROM app.automation_runs')
        ? 'run'
        : s.text.includes('UPDATE app.automation_node_attempts')
          ? 'attempt'
          : s.text.includes('INSERT INTO app.automation_run_events')
            ? 'event'
            : s.text.includes('UPDATE app.automation_runs')
              ? 'wake'
              : s.text.includes("set_config('tale.automation_writer_protocol'")
                ? 'protocol'
                : 'other',
    );
    expect(order).toEqual(['run', 'attempt', 'event', 'protocol', 'wake']);
    expect(fake.statements[0]?.text).toContain('FOR UPDATE');
    expect(fake.statements[1]?.text).toContain(
      "AND kind = 'connector' AND status = 'started' AND resolution IS NULL",
    );
    expect(fake.statements[1]?.values).toEqual(
      expect.arrayContaining(['retry', 'u_mia', 'att_1', 'run_1', 'org_1']),
    );
    expect(createAuditLog).toHaveBeenCalledWith(
      fake.sql,
      expect.objectContaining({
        actorId: 'u_mia',
        actorType: 'user',
        action: 'automation.run.in_doubt_resolved',
        resourceId: 'run_1',
        resourceName: 'billing/invoices@4',
        metadata: {
          nodeId: 'send',
          itemIndex: 2,
          pass: 0,
          resolution: 'retry',
        },
      }),
    );
    expect(addJobInTx).toHaveBeenCalledWith(
      fake.sql,
      'automation.step',
      { organizationId: 'org_1', runId: 'run_1' },
      {},
    );
  });

  it('writes no audit row for a test run', async () => {
    const fake = decisionFake(inDoubtRun('mock'));
    await decide(fake.sql);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a run that is not parked', { ...inDoubtRun('live'), status: 'running' }],
    [
      'a run parked on something else',
      { ...inDoubtRun('live'), detail: 'approval:appr_1' },
    ],
    ['a run that does not exist', null],
  ])('refuses a decision about %s', async (_case, run) => {
    const fake = decisionFake(run);
    await expect(decide(fake.sql)).rejects.toMatchObject({
      code: 'RUN_NOT_IN_DOUBT',
      status: 409,
    });
    expect(
      statementWith(fake.statements, 'UPDATE app.automation_node_attempts'),
    ).toBeUndefined();
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('decides only the write the run waits on, the one its card shows [AUTO-R19]', async () => {
    const fake = decisionFake(inDoubtRun('live'));
    await decide(fake.sql);
    const update = statementWith(
      fake.statements,
      'UPDATE app.automation_node_attempts',
    );
    // The latest open write, the same one `readOpenInDoubt` answers.
    expect(update?.text).toContain('AND id = (');
    expect(update?.text).toContain(
      "shown.kind = 'connector' AND shown.status = 'started'",
    );
    expect(update?.text).toContain(
      'ORDER BY shown.started_at_ms DESC, shown.id DESC',
    );
  });

  it('refuses a choice about an earlier attempt of the same write [AUTO-R19]', async () => {
    // Run it again kept the row and took attempt 2, and that attempt was
    // interrupted too. A choice about attempt 1 that lands now must not
    // send the write again, skip it or fail the run: it decides nothing,
    // records nothing and wakes nothing.
    const fake = decisionFake(inDoubtRun('live'), true, 2);
    for (const resolution of ['retry', 'skip', 'fail'] as const) {
      await expect(decide(fake.sql, resolution, 1)).rejects.toMatchObject({
        code: 'IN_DOUBT_ALREADY_RESOLVED',
        status: 409,
      });
    }
    expect(
      statementWith(fake.statements, 'INSERT INTO app.automation_run_events'),
    ).toBeUndefined();
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();

    // A choice about attempt 2 itself is taken.
    await decide(fake.sql, 'skip', 2);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(addJobInTx).toHaveBeenCalledTimes(1);
  });

  it('refuses a second decision about the same write', async () => {
    const fake = decisionFake(inDoubtRun('live'), false);
    await expect(decide(fake.sql)).rejects.toMatchObject({
      code: 'IN_DOUBT_ALREADY_RESOLVED',
      status: 409,
    });
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(addJobInTx).not.toHaveBeenCalled();
  });
});
