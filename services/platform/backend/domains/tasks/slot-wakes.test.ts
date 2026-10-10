import {
  markRetryQueueKey,
  retryQueueKeysOf,
} from '@tale/shared/db/serializable';
import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  memberSessionIdForProjectAgent,
  standingSessionIdForProjectAgent,
  workerSessionId,
} from '../../core/sandbox/session_naming.ts';
import { recordTaskAgentRunLedgerEntry } from './run-ledger.ts';
import {
  WAKE_BACKOFF_CAP_MS,
  recordRunTerminalInTx,
  recordSlotReleaseInTx,
  releaseSignals,
  selfRunWakeWrite,
  wakeBackoffMs,
} from './slot-wakes.ts';

vi.mock('./run-ledger.ts', () => ({ recordTaskAgentRunLedgerEntry: vi.fn() }));

type Row = Record<string, unknown>;

/** A postgres.js tagged-template stand-in answering each statement from its
 * (whitespace-collapsed) text; `fail` throws for the statements it names. */
function fakeTx(
  answer: (text: string) => Row[],
  fail?: (text: string) => Error | undefined,
): { tx: TransactionSql; statements: string[] } {
  const statements: string[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<Row[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push(text);
    const error = fail?.(text);
    if (error !== undefined) return Promise.reject(error);
    return Promise.resolve(answer(text));
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js template function
  return { tx: tag as unknown as TransactionSql, statements };
}

function serializationFailure(): Error {
  return Object.assign(new Error('could not serialize access'), {
    code: '40001',
  });
}

const ORG = 'org-1';
const KEYS = { runId: 'run-1', organizationId: ORG };
const RUN_READ = 'SELECT org_id AS "organizationId", project_id';
const TARGET_READ = 'SELECT t.id FROM app.automation_triggers t';
const ORIGIN_READ = 'SELECT id FROM app.automation_runs';
const MANAGER_READ = 'SELECT manager_task_id';
const BUSY_READ = 'SELECT id FROM app.project_agent_runs';
const CHAIN_KEY = 'SELECT pg_advisory_xact_lock';
const UPSERT = 'INSERT INTO app.project_wakes';

/** A worker's run that ended in its agent's standing workspace. */
function released(overrides: Row = {}): Row {
  return {
    organizationId: ORG,
    projectId: 'project-1',
    taskId: 'task-1',
    agentId: 'agent-1',
    sessionId: 'pa-agent-1',
    status: 'settled',
    launched: true,
    startedVia: null,
    startedViaRunId: null,
    retryArmed: false,
    ...overrides,
  };
}

function answering(run: Row, more: (text: string) => Row[] = () => []) {
  return (text: string): Row[] => {
    if (text.startsWith(RUN_READ)) return [run];
    if (text.startsWith(TARGET_READ)) return [{ id: 'trigger-T' }];
    return more(text);
  };
}

describe('wakeBackoffMs — capped, never exhausted [AUTO-R33]', () => {
  it('doubles from one minute and stops at sixty for good', () => {
    const minutes = [1, 2, 3, 4, 5, 6, 7, 8, 50].map(
      (n) => wakeBackoffMs(n) / 60_000,
    );
    expect(minutes).toEqual([1, 2, 4, 8, 16, 32, 60, 60, 60]);
  });

  it('answers a finite wait for any attempt count (W8: no exhaustion)', () => {
    for (const n of [100, 10_000, Number.MAX_SAFE_INTEGER, Infinity]) {
      const wait = wakeBackoffMs(n);
      expect(Number.isFinite(wait)).toBe(true);
      expect(wait).toBe(WAKE_BACKOFF_CAP_MS);
    }
  });
});

describe('selfRunWakeWrite — only a launched and settled turn consumes (D6) [AUTO-R31]', () => {
  it('consumes on a settled turn that launched', () => {
    expect(selfRunWakeWrite({ status: 'settled', launched: true })).toEqual({
      kind: 'consume',
    });
  });

  it('never consumes on a cancel, queued or running (W18)', () => {
    expect(selfRunWakeWrite({ status: 'cancelled' })).toEqual({
      kind: 'non_serving',
      outcome: 'manager_cancelled',
    });
  });

  it('counts a settle without a launch and a failure for good as non-serving (W12)', () => {
    expect(selfRunWakeWrite({ status: 'settled', launched: false })).toEqual({
      kind: 'non_serving',
      outcome: 'manager_failed',
    });
    expect(selfRunWakeWrite({ status: 'failed', retryArmed: false })).toEqual({
      kind: 'non_serving',
      outcome: 'manager_failed',
    });
  });

  it('writes nothing while the failed turn’s retry is armed (W12)', () => {
    expect(selfRunWakeWrite({ status: 'failed', retryArmed: true })).toEqual({
      kind: 'none',
    });
  });
});

describe('releaseSignals — the workspace-free predicate (W13)', () => {
  const free = {
    inStandingWorkspace: true,
    retryArmed: false,
    workspaceBusy: false,
  };

  it('signals a free standing workspace', () => {
    expect(releaseSignals(free)).toBe(true);
  });

  it.each([
    ['an armed retry', { retryArmed: true }],
    ['another live run in the workspace', { workspaceBusy: true }],
    ['a member’s own workspace', { inStandingWorkspace: false }],
  ])('does not signal %s', (_case, change) => {
    expect(releaseSignals({ ...free, ...change })).toBe(false);
  });
});

describe('recordSlotReleaseInTx — the signal rides the run’s end', () => {
  beforeEach(() => {
    vi.mocked(recordTaskAgentRunLedgerEntry).mockReset();
  });

  it('upserts the wake row under the chain key, the key first (W1)', async () => {
    const { tx, statements } = fakeTx(answering(released()));
    await recordSlotReleaseInTx(tx, KEYS);
    const key = statements.findIndex((text) => text.startsWith(CHAIN_KEY));
    const upsert = statements.findIndex((text) => text.startsWith(UPSERT));
    expect(key).toBeGreaterThan(-1);
    expect(upsert).toBeGreaterThan(key);
    expect(statements[upsert]).toContain('signal_seq = w.signal_seq + 1');
  });

  it.each(['agent-1', 'a'.repeat(60)])(
    'signals a higher standing worker for %s',
    async (agentId) => {
      const sessionId = workerSessionId(
        agentId,
        standingSessionIdForProjectAgent(agentId),
        2,
      );
      const { tx, statements } = fakeTx(
        answering(released({ agentId, sessionId })),
      );
      await recordSlotReleaseInTx(tx, KEYS);
      expect(statements.some((text) => text.startsWith(UPSERT))).toBe(true);
      const busy = statements.find((text) => text.startsWith(BUSY_READ));
      expect(busy).toContain('session_claimed_at_ms IS NOT NULL');
      expect(busy).toContain('waiting_for_capacity_at_ms IS NULL');
    },
  );

  it.each([1, 2])('never signals a member-family worker %s', async (worker) => {
    const agentId = 'agent-1';
    const sessionId = workerSessionId(
      agentId,
      memberSessionIdForProjectAgent(agentId, 'member-1'),
      worker,
    );
    const { tx, statements } = fakeTx(
      answering(released({ agentId, sessionId })),
    );
    await recordSlotReleaseInTx(tx, KEYS);
    expect(statements.some((text) => text.startsWith(UPSERT))).toBe(false);
  });

  it('writes nothing for a project without a wake target', async () => {
    const { tx, statements } = fakeTx((text) =>
      text.startsWith(RUN_READ) ? [released()] : [],
    );
    await recordSlotReleaseInTx(tx, KEYS);
    expect(statements.some((text) => text.startsWith(UPSERT))).toBe(false);
  });

  it('never signals for the role’s own run (no recursive self-start) [AUTO-R32]', async () => {
    const { tx, statements } = fakeTx(
      answering(
        released({ startedVia: 'automation', startedViaRunId: 'occ-1' }),
        (text) => (text.startsWith(ORIGIN_READ) ? [{ id: 'occ-1' }] : []),
      ),
    );
    await recordSlotReleaseInTx(tx, KEYS);
    expect(statements.some((text) => text.startsWith(UPSERT))).toBe(false);
  });

  it('never signals for another run on the manager’s own card [AUTO-R32]', async () => {
    const { tx, statements } = fakeTx(
      answering(released(), (text) =>
        text.startsWith(MANAGER_READ) ? [{ managerTaskId: 'task-1' }] : [],
      ),
    );
    await recordSlotReleaseInTx(tx, KEYS);
    expect(statements.some((text) => text.startsWith(UPSERT))).toBe(false);
  });

  it('does not signal while another run holds the workspace (W13)', async () => {
    const { tx, statements } = fakeTx(
      answering(released(), (text) =>
        text.startsWith(BUSY_READ) ? [{ id: 'run-2' }] : [],
      ),
    );
    await recordSlotReleaseInTx(tx, KEYS);
    expect(statements.some((text) => text.startsWith(UPSERT))).toBe(false);
  });

  it('propagates a signal fault instead of swallowing it (F1, W9) [AUTO-R30]', async () => {
    const fault = new Error('wake row unavailable');
    const { tx } = fakeTx(answering(released()), (text) =>
      text.startsWith(UPSERT) ? fault : undefined,
    );
    await expect(recordSlotReleaseInTx(tx, KEYS)).rejects.toBe(fault);
  });

  it("marks a serialization failure with the project's work key alone; outer marks prepend (R3, W16)", async () => {
    const failure = serializationFailure();
    const { tx } = fakeTx(answering(released()), (text) =>
      text.startsWith(UPSERT) ? failure : undefined,
    );
    const thrown: unknown = await recordSlotReleaseInTx(tx, KEYS).catch(
      (error: unknown) => error,
    );
    expect(thrown).toBe(failure);
    expect(retryQueueKeysOf(thrown)).toEqual(['project-work:project-1']);
    // The completion wraps the callback in `queuedOnTask`, whose mark is the
    // outer one: the queued retry takes both keys, the task's first.
    markRetryQueueKey(thrown, 'task-comment:task-1');
    expect(retryQueueKeysOf(thrown)).toEqual([
      'task-comment:task-1',
      'project-work:project-1',
    ]);
  });
});

describe('recordRunTerminalInTx — ledger, then release, in one transaction', () => {
  beforeEach(() => {
    vi.mocked(recordTaskAgentRunLedgerEntry).mockReset();
  });

  it('records the release after the ledger entry (W1: mutant A drops it)', async () => {
    const order: string[] = [];
    vi.mocked(recordTaskAgentRunLedgerEntry).mockImplementation(async () => {
      order.push('ledger');
    });
    const { tx } = fakeTx((text) => {
      if (text.startsWith(UPSERT)) order.push('release');
      return answering(released())(text);
    });
    await recordRunTerminalInTx(tx, {
      runId: 'run-1',
      organizationId: ORG,
      finalStatus: 'settled',
      settledAt: 1,
    });
    expect(order).toEqual(['ledger', 'release']);
  });

  it('fails the run’s end when the release fails (W9: mutant B swallows it) [AUTO-R30]', async () => {
    const fault = new Error('wake row unavailable');
    const { tx } = fakeTx(answering(released()), (text) =>
      text.startsWith(UPSERT) ? fault : undefined,
    );
    await expect(
      recordRunTerminalInTx(tx, {
        runId: 'run-1',
        organizationId: ORG,
        finalStatus: 'settled',
        settledAt: 1,
      }),
    ).rejects.toBe(fault);
  });
});
