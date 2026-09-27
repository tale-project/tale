// @vitest-environment node

/**
 * Unit lock for the trigger failure streak (`recordTriggerRunOutcome`, run
 * from `finishRun`): only a trigger's run moves it, a success resets it, a
 * transient or unclassified failure leaves it alone, a permanent failure
 * counts — and the one that brings an ENABLED SCHEDULE to the threshold
 * pauses it, audits the pause and notifies the owners and admins, all in
 * the caller's transaction. Webhook and event bindings count but never
 * pause. The real-Postgres probe (`trigger-pause.integration.ts`) drives an
 * always-failing schedule through the stepper until it pauses.
 */

import type { TransactionSql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMANENT_FAILURES_BEFORE_PAUSE } from '../../core/automations/failure.ts';

const { createAuditLog, notifyTriggerPaused } = vi.hoisted(() => ({
  createAuditLog: vi.fn(async () => 'audit_1'),
  notifyTriggerPaused: vi.fn(async () => 2),
}));
vi.mock('../audit_logs/service.ts', () => ({ createAuditLog }));
vi.mock('../collab/service.ts', () => ({ notifyTriggerPaused }));

import {
  recordTriggerRunOutcome,
  type TriggerRunOutcome,
} from './trigger-failures.ts';

interface Statement {
  text: string;
  values: unknown[];
}

interface CountedRow {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
  consecutiveFailures: number;
}

/** Scripted transaction: the success reset answers `resetRows`, the count
 * answers `counted` (nothing when the trigger is gone or was saved after
 * the run started) or throws `countFault`, the pause answers nothing. A
 * savepoint runs its body on the same handle and counts how deep it went. */
function fakeTx(script: {
  resetRows?: { name: string }[];
  counted?: CountedRow | null;
  countFault?: Error;
}): { tx: TransactionSql; statements: Statement[]; savepoints: number[] } {
  const statements: Statement[] = [];
  const savepoints: number[] = [];
  let depth = 0;
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('SET consecutive_failures = 0')) {
      return Promise.resolve(script.resetRows ?? []);
    }
    if (text.includes('consecutive_failures + 1')) {
      if (script.countFault !== undefined) {
        return Promise.reject(script.countFault);
      }
      return Promise.resolve(
        script.counted === null || script.counted === undefined
          ? []
          : [script.counted],
      );
    }
    if (text.includes('enabled = false')) return Promise.resolve([]);
    throw new Error(`unexpected statement: ${text}`);
  };
  fn.savepoint = async (body: (sp: unknown) => Promise<unknown>) => {
    depth++;
    savepoints.push(depth);
    try {
      return await body(fn);
    } finally {
      depth--;
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for the transaction
  return { tx: fn as unknown as TransactionSql, statements, savepoints };
}

const outcome = (
  overrides: Partial<TriggerRunOutcome> = {},
): TriggerRunOutcome => ({
  organizationId: 'org_1',
  runId: 'run_9',
  startedBy: 'trigger:trg_1',
  startedAt: 1_000,
  status: 'failed',
  failureCode: 'node_error',
  now: 5_000,
  ...overrides,
});

const schedule = (consecutiveFailures: number, enabled = true): CountedRow => ({
  id: 'trg_1',
  name: 'ops/nightly',
  kind: 'schedule',
  enabled,
  consecutiveFailures,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('recordTriggerRunOutcome', () => {
  it.each(['user:u_1', 'api-key:u_1', 'u_1', 'trigger:'])(
    'leaves every trigger alone for a run started by %s',
    async (startedBy) => {
      const fake = fakeTx({ counted: schedule(4) });
      await expect(
        recordTriggerRunOutcome(fake.tx, outcome({ startedBy })),
      ).resolves.toBeNull();
      expect(fake.statements).toHaveLength(0);
    },
  );

  it('resets the streak on a success, for runs started since the last save', async () => {
    const fake = fakeTx({ resetRows: [{ name: 'ops/nightly' }] });
    await expect(
      recordTriggerRunOutcome(
        fake.tx,
        outcome({ status: 'success', failureCode: null }),
      ),
    ).resolves.toEqual({ name: 'ops/nightly', paused: false });
    expect(fake.statements).toHaveLength(1);
    const [reset] = fake.statements;
    expect(reset?.text).toContain('consecutive_failures > 0');
    expect(reset?.text).toContain('updated_at_ms <= ?');
    expect(reset?.values).toEqual(['trg_1', 'org_1', 1_000]);
  });

  it('answers null when a success had no streak to reset', async () => {
    const fake = fakeTx({ resetRows: [] });
    await expect(
      recordTriggerRunOutcome(
        fake.tx,
        outcome({ status: 'success', failureCode: null }),
      ),
    ).resolves.toBeNull();
  });

  it.each([['rate_limited'], ['provider_unreachable'], ['deadline'], [null]])(
    'neither counts nor breaks the streak for a %s failure',
    async (failureCode) => {
      const fake = fakeTx({ counted: schedule(4) });
      await expect(
        recordTriggerRunOutcome(fake.tx, outcome({ failureCode })),
      ).resolves.toBeNull();
      expect(fake.statements).toHaveLength(0);
    },
  );

  it('counts a permanent failure and names it the last failure', async () => {
    const fake = fakeTx({ counted: schedule(2) });
    await expect(
      recordTriggerRunOutcome(
        fake.tx,
        outcome({ failureCode: 'connector_error' }),
      ),
    ).resolves.toEqual({ name: 'ops/nightly', paused: false });
    expect(fake.statements).toHaveLength(1);
    const [count] = fake.statements;
    // A save after the last counted failure makes the old streak stale.
    expect(count?.text).toContain('last_failed_at_ms < updated_at_ms');
    expect(count?.text).toContain('updated_at_ms <= ?');
    expect(count?.values).toEqual([
      5_000,
      'connector_error',
      'run_9',
      'trg_1',
      'org_1',
      1_000,
    ]);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(notifyTriggerPaused).not.toHaveBeenCalled();
  });

  it('answers null when the trigger is gone or was saved after the run started', async () => {
    const fake = fakeTx({ counted: null });
    await expect(
      recordTriggerRunOutcome(fake.tx, outcome()),
    ).resolves.toBeNull();
    expect(fake.statements).toHaveLength(1);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('pauses an enabled schedule at the threshold, audits it and tells the admins', async () => {
    const fake = fakeTx({
      counted: schedule(PERMANENT_FAILURES_BEFORE_PAUSE),
    });
    await expect(
      recordTriggerRunOutcome(fake.tx, outcome({ failureCode: 'auth_error' })),
    ).resolves.toEqual({ name: 'ops/nightly', paused: true });

    expect(fake.statements).toHaveLength(2);
    const pause = fake.statements[1];
    expect(pause?.text).toContain('enabled = false');
    expect(pause?.text).toContain("last_skip_reason = 'paused_after_failures'");
    expect(pause?.values).toEqual([5_000, 'trg_1']);

    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledWith(
      fake.tx,
      expect.objectContaining({
        organizationId: 'org_1',
        actorId: 'trigger:trg_1',
        actorType: 'system',
        action: 'automation.trigger.paused',
        resourceType: 'automation_trigger',
        resourceId: 'trg_1',
        resourceName: 'ops/nightly',
        previousState: { enabled: true },
        newState: { enabled: false, lastSkipReason: 'paused_after_failures' },
        status: 'success',
        metadata: {
          consecutiveFailures: PERMANENT_FAILURES_BEFORE_PAUSE,
          pauseAfter: PERMANENT_FAILURES_BEFORE_PAUSE,
          lastFailureCode: 'auth_error',
          lastFailedRunId: 'run_9',
        },
      }),
    );
    expect(notifyTriggerPaused).toHaveBeenCalledWith(fake.tx, {
      organizationId: 'org_1',
      triggerId: 'trg_1',
      name: 'ops/nightly',
      failures: PERMANENT_FAILURES_BEFORE_PAUSE,
      code: 'auth_error',
    });
  });

  it('does not pause a schedule that is already off, or tell anyone twice', async () => {
    const fake = fakeTx({
      counted: schedule(PERMANENT_FAILURES_BEFORE_PAUSE + 1, false),
    });
    await expect(recordTriggerRunOutcome(fake.tx, outcome())).resolves.toEqual({
      name: 'ops/nightly',
      paused: false,
    });
    expect(fake.statements).toHaveLength(1);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(notifyTriggerPaused).not.toHaveBeenCalled();
  });

  it.each(['webhook', 'event'])(
    'keeps counting for a %s binding and never pauses it',
    async (kind) => {
      const fake = fakeTx({
        counted: {
          ...schedule(PERMANENT_FAILURES_BEFORE_PAUSE + 3),
          kind,
        },
      });
      await expect(
        recordTriggerRunOutcome(fake.tx, outcome()),
      ).resolves.toEqual({ name: 'ops/nightly', paused: false });
      expect(fake.statements).toHaveLength(1);
      expect(createAuditLog).not.toHaveBeenCalled();
      expect(notifyTriggerPaused).not.toHaveBeenCalled();
    },
  );
  it('keeps the streak inside a savepoint, and opens none for a run it ignores', async () => {
    const counted = fakeTx({ counted: schedule(1) });
    await recordTriggerRunOutcome(counted.tx, outcome());
    expect(counted.savepoints).toEqual([1]);

    const ignored = fakeTx({ counted: schedule(1) });
    await recordTriggerRunOutcome(
      ignored.tx,
      outcome({ failureCode: 'rate_limited' }),
    );
    expect(ignored.savepoints).toEqual([]);
  });

  it('never fails the landing run over its own fault: logged, the run lands', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakeTx({ countFault: new Error('connection reset') });
    await expect(
      recordTriggerRunOutcome(fake.tx, outcome()),
    ).resolves.toBeNull();
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('run_9: the failure streak of trigger trg_1'),
      'connection reset',
    );
    expect(createAuditLog).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('keeps the pause and its audit row when the notice cannot be sent', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    notifyTriggerPaused.mockRejectedValueOnce(new Error('mail queue down'));
    const fake = fakeTx({
      counted: schedule(PERMANENT_FAILURES_BEFORE_PAUSE),
    });
    await expect(recordTriggerRunOutcome(fake.tx, outcome())).resolves.toEqual({
      name: 'ops/nightly',
      paused: true,
    });
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    // The notice rode a savepoint of its own, inside the streak's.
    expect(fake.savepoints).toEqual([1, 2]);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining('ops/nightly: the pause notice was not sent'),
      'mail queue down',
    );
    logged.mockRestore();
  });
});
