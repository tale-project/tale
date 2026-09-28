// @vitest-environment node

/**
 * Unit lock for the trigger failure streak (`recordTriggerRunOutcome`, run
 * from `finishRun`): only a trigger's run moves it, a success resets it, a
 * transient or unclassified failure leaves it alone, a permanent failure
 * counts — and the one that brings an ENABLED SCHEDULE to the threshold
 * pauses it, audits the pause and notifies the owners and admins, all in
 * the caller's transaction. Webhook and event bindings count but never
 * pause, and a paused schedule — off with the pause's stamp, never the
 * stamp alone — keeps the streak and the last failure that paused it,
 * whichever way a run that overlapped the pause lands. Each statement is
 * judged against a scripted trigger row by its WHERE clause, so the rows it
 * matches — not merely its wording — decide each outcome here. The
 * real-Postgres probes drive an always-failing schedule through the stepper
 * until it pauses, land a success and a permanent failure after the pause
 * and a success on a live schedule still carrying the stamp
 * (`trigger-pause.integration.ts`), and land a run beside an event producer
 * stamping the same trigger in either order
 * (`trigger-lock-order.integration.ts`).
 */

import type { TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

/** The `app.automation_triggers` columns the streak's statements read and
 * write. */
interface TriggerRow {
  id: string;
  orgId: string;
  name: string;
  kind: string;
  enabled: boolean;
  lastSkipReason: string | null;
  consecutiveFailures: number;
  lastFailedAt: number | null;
  lastFailureCode: string | null;
  lastFailedRunId: string | null;
  /** `updated_at_ms`: when the trigger was last saved. */
  updatedAt: number;
}

/**
 * Every conjunct a streak statement's WHERE may carry, with what it means
 * for the row; `$n` is the statement's n-th value. A conjunct missing here
 * fails the test that met it, so a predicate that is reworded or inverted
 * cannot pass unnoticed: its meaning has to be written down first. One that
 * is dropped stops holding the row back, and the outcomes below change.
 */
const CONJUNCTS: readonly (readonly [
  RegExp,
  (row: TriggerRow, value: unknown) => boolean,
])[] = [
  [/^id = \$(\d+)$/, (row, value) => row.id === value],
  [/^org_id = \$(\d+)$/, (row, value) => row.orgId === value],
  [/^consecutive_failures > 0$/, (row) => row.consecutiveFailures > 0],
  [
    /^\(enabled OR last_skip_reason IS DISTINCT FROM 'paused_after_failures'\)$/,
    (row) => row.enabled || row.lastSkipReason !== 'paused_after_failures',
  ],
  [
    /^updated_at_ms <= \$(\d+)$/,
    (row, value) => typeof value === 'number' && row.updatedAt <= value,
  ],
];

/** What the fake could not judge. The streak's own catch swallows the
 * throw, so every test checks this stayed empty. */
const unjudged: string[] = [];

/** Does the statement's WHERE hold for the row? */
function matches(numbered: string, values: unknown[], row: TriggerRow) {
  const where = / WHERE (.+?)(?: RETURNING .*)?$/.exec(numbered)?.[1];
  if (where === undefined) {
    unjudged.push(numbered);
    throw new Error(`no WHERE in: ${numbered}`);
  }
  return where.split(' AND ').every((conjunct) => {
    const known = CONJUNCTS.find(([pattern]) => pattern.test(conjunct));
    if (known === undefined) {
      unjudged.push(conjunct);
      throw new Error(`unknown predicate "${conjunct}" in: ${numbered}`);
    }
    const [pattern, holds] = known;
    const position = pattern.exec(conjunct)?.[1];
    return holds(
      row,
      position === undefined ? undefined : values[Number(position) - 1],
    );
  });
}

/** Scripted transaction over one trigger row (null: the trigger is gone).
 * The success reset, the count and the pause each touch the row only when
 * their WHERE holds for it, write it as their SET does, and answer what
 * their RETURNING names; the count throws `countFault` instead when given
 * one. A savepoint runs its body on the same handle and counts how deep it
 * went. */
function fakeTx(script: { trigger: TriggerRow | null; countFault?: Error }): {
  tx: TransactionSql;
  statements: Statement[];
  savepoints: number[];
  row: TriggerRow | null;
} {
  const statements: Statement[] = [];
  const savepoints: number[] = [];
  const row = script.trigger === null ? null : { ...script.trigger };
  let depth = 0;
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    const numbered = strings
      .reduce((joined, part, index) => `${joined}$${index}${part}`)
      .replace(/\s+/g, ' ')
      .trim();
    const hit = (candidate: TriggerRow | null): candidate is TriggerRow =>
      candidate !== null && matches(numbered, values, candidate);
    if (text.includes('SET consecutive_failures = 0')) {
      if (!hit(row)) return Promise.resolve([]);
      row.consecutiveFailures = 0;
      return Promise.resolve([{ name: row.name }]);
    }
    if (text.includes('consecutive_failures + 1')) {
      if (script.countFault !== undefined) {
        return Promise.reject(script.countFault);
      }
      if (!hit(row)) return Promise.resolve([]);
      const [now, code, runId] = values;
      row.consecutiveFailures =
        row.lastFailedAt === null || row.lastFailedAt < row.updatedAt
          ? 1
          : row.consecutiveFailures + 1;
      row.lastFailedAt = typeof now === 'number' ? now : null;
      row.lastFailureCode = typeof code === 'string' ? code : null;
      row.lastFailedRunId = typeof runId === 'string' ? runId : null;
      const { id, name, kind, enabled, consecutiveFailures } = row;
      return Promise.resolve([
        { id, name, kind, enabled, consecutiveFailures },
      ]);
    }
    if (text.includes('enabled = false')) {
      if (hit(row)) {
        row.enabled = false;
        row.lastSkipReason = 'paused_after_failures';
      }
      return Promise.resolve([]);
    }
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
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for the transaction
    tx: fn as unknown as TransactionSql,
    statements,
    savepoints,
    row,
  };
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

const success = outcome({ status: 'success', failureCode: null });

/** An enabled schedule saved before the run started (`updatedAt` 500 <
 * `startedAt` 1 000), with `consecutiveFailures` failures in a row since —
 * the last of them `run_8` — and whatever else `overrides` says. */
const schedule = (
  consecutiveFailures: number,
  overrides: Partial<TriggerRow> = {},
): TriggerRow => ({
  id: 'trg_1',
  orgId: 'org_1',
  name: 'ops/nightly',
  kind: 'schedule',
  enabled: true,
  lastSkipReason: null,
  consecutiveFailures,
  lastFailedAt: consecutiveFailures > 0 ? 900 : null,
  lastFailureCode: consecutiveFailures > 0 ? 'connector_error' : null,
  lastFailedRunId: consecutiveFailures > 0 ? 'run_8' : null,
  updatedAt: 500,
  ...overrides,
});

/** Off with the pause's stamp: the schedule its failures paused. */
const PAUSED: Partial<TriggerRow> = {
  enabled: false,
  lastSkipReason: 'paused_after_failures',
};

beforeEach(() => {
  vi.clearAllMocks();
  unjudged.length = 0;
});

afterEach(() => {
  expect(unjudged, 'WHERE conjuncts the fake cannot judge').toEqual([]);
});

describe('recordTriggerRunOutcome', () => {
  it.each(['user:u_1', 'api-key:u_1', 'u_1', 'trigger:'])(
    'leaves every trigger alone for a run started by %s',
    async (startedBy) => {
      const fake = fakeTx({ trigger: schedule(4) });
      await expect(
        recordTriggerRunOutcome(fake.tx, outcome({ startedBy })),
      ).resolves.toBeNull();
      expect(fake.statements).toHaveLength(0);
    },
  );

  it('resets the streak on a success, for runs started since the last save', async () => {
    const fake = fakeTx({ trigger: schedule(3) });
    await expect(recordTriggerRunOutcome(fake.tx, success)).resolves.toEqual({
      name: 'ops/nightly',
      paused: false,
    });
    expect(fake.row?.consecutiveFailures).toBe(0);
    expect(fake.statements).toHaveLength(1);
    const [reset] = fake.statements;
    expect(reset?.text).toContain('consecutive_failures > 0');
    expect(reset?.text).toContain('updated_at_ms <= ?');
    expect(reset?.values).toEqual(['trg_1', 'org_1', 1_000]);
  });

  // Paused is off AND stamped, as the banner reads it. A run that
  // overlapped the pause and succeeded after it must not make the paused
  // schedule read "0 runs in a row failed". The image before 0124
  // re-enables a paused schedule and keeps its stamp: the stamp alone must
  // not hold the streak, or that schedule's failures add up across its
  // successes and pause it again for failures that were not in a row.
  // `trigger-pause.integration.ts` lands a success on both rows.
  it.each<[string, TriggerRow, { name: string; paused: false } | null, number]>(
    [
      [
        'keeps the streak of a schedule its failures paused (off, stamped)',
        schedule(PERMANENT_FAILURES_BEFORE_PAUSE, PAUSED),
        null,
        PERMANENT_FAILURES_BEFORE_PAUSE,
      ],
      [
        'resets a live schedule that still carries the pause stamp',
        schedule(PERMANENT_FAILURES_BEFORE_PAUSE, {
          lastSkipReason: 'paused_after_failures',
        }),
        { name: 'ops/nightly', paused: false },
        0,
      ],
      [
        'resets a live schedule with no stamp',
        schedule(3),
        { name: 'ops/nightly', paused: false },
        0,
      ],
      [
        'resets a schedule turned off by hand',
        schedule(3, { enabled: false }),
        { name: 'ops/nightly', paused: false },
        0,
      ],
      [
        'keeps the streak of a trigger saved after the run started',
        schedule(3, { updatedAt: 2_000 }),
        null,
        3,
      ],
    ],
  )('on a success, %s', async (_label, trigger, change, streak) => {
    const fake = fakeTx({ trigger });
    await expect(recordTriggerRunOutcome(fake.tx, success)).resolves.toEqual(
      change,
    );
    expect(fake.row?.consecutiveFailures).toBe(streak);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('answers null when a success had no streak to reset', async () => {
    const fake = fakeTx({ trigger: schedule(0) });
    await expect(recordTriggerRunOutcome(fake.tx, success)).resolves.toBeNull();
  });

  it.each([['rate_limited'], ['provider_unreachable'], ['deadline'], [null]])(
    'neither counts nor breaks the streak for a %s failure',
    async (failureCode) => {
      const fake = fakeTx({ trigger: schedule(4) });
      await expect(
        recordTriggerRunOutcome(fake.tx, outcome({ failureCode })),
      ).resolves.toBeNull();
      expect(fake.statements).toHaveLength(0);
    },
  );

  it('counts a permanent failure and names it the last failure', async () => {
    const fake = fakeTx({ trigger: schedule(2) });
    await expect(
      recordTriggerRunOutcome(
        fake.tx,
        outcome({ failureCode: 'connector_error' }),
      ),
    ).resolves.toEqual({ name: 'ops/nightly', paused: false });
    expect(fake.row).toMatchObject({
      consecutiveFailures: 3,
      lastFailedAt: 5_000,
      lastFailureCode: 'connector_error',
      lastFailedRunId: 'run_9',
    });
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

  it('starts a new streak at one when the trigger was saved after its last counted failure', async () => {
    const fake = fakeTx({ trigger: schedule(4, { updatedAt: 950 }) });
    await recordTriggerRunOutcome(fake.tx, outcome());
    expect(fake.row?.consecutiveFailures).toBe(1);
  });

  it.each<[string, TriggerRow | null]>([
    ['is gone', null],
    ['was saved after the run started', schedule(2, { updatedAt: 2_000 })],
  ])('answers null when the trigger %s', async (_label, trigger) => {
    const fake = fakeTx({ trigger });
    await expect(
      recordTriggerRunOutcome(fake.tx, outcome()),
    ).resolves.toBeNull();
    expect(fake.statements).toHaveLength(1);
    expect(fake.row).toEqual(trigger);
    expect(createAuditLog).not.toHaveBeenCalled();
  });

  it('pauses an enabled schedule at the threshold, audits it and tells the admins', async () => {
    const fake = fakeTx({
      trigger: schedule(PERMANENT_FAILURES_BEFORE_PAUSE - 1),
    });
    await expect(
      recordTriggerRunOutcome(fake.tx, outcome({ failureCode: 'auth_error' })),
    ).resolves.toEqual({ name: 'ops/nightly', paused: true });

    expect(fake.row).toMatchObject({
      enabled: false,
      lastSkipReason: 'paused_after_failures',
      consecutiveFailures: PERMANENT_FAILURES_BEFORE_PAUSE,
      lastFailedRunId: 'run_9',
    });
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

  // A run still in flight when the pause landed fails permanently after it:
  // the banner keeps the count and the failure that paused the schedule,
  // and **View run** keeps opening that run.
  it('leaves the streak and the last failure of a schedule its failures paused', async () => {
    const paused = schedule(PERMANENT_FAILURES_BEFORE_PAUSE, PAUSED);
    const fake = fakeTx({ trigger: paused });
    await expect(
      recordTriggerRunOutcome(fake.tx, outcome({ failureCode: 'auth_error' })),
    ).resolves.toBeNull();
    expect(fake.row).toEqual(paused);
    expect(fake.statements).toHaveLength(1);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(notifyTriggerPaused).not.toHaveBeenCalled();
  });

  // The stamp alone holds nothing: a live schedule an older image turned
  // back on counts its failures, or it could never pause again.
  it('counts on a live schedule that still carries the pause stamp, and pauses it again', async () => {
    const fake = fakeTx({
      trigger: schedule(PERMANENT_FAILURES_BEFORE_PAUSE - 1, {
        lastSkipReason: 'paused_after_failures',
      }),
    });
    await expect(recordTriggerRunOutcome(fake.tx, outcome())).resolves.toEqual({
      name: 'ops/nightly',
      paused: true,
    });
    expect(fake.row).toMatchObject({
      enabled: false,
      consecutiveFailures: PERMANENT_FAILURES_BEFORE_PAUSE,
      lastFailedRunId: 'run_9',
    });
    expect(createAuditLog).toHaveBeenCalledTimes(1);
  });

  it('counts for a schedule turned off by hand, and never pauses it or tells anyone', async () => {
    const fake = fakeTx({
      trigger: schedule(PERMANENT_FAILURES_BEFORE_PAUSE, { enabled: false }),
    });
    await expect(recordTriggerRunOutcome(fake.tx, outcome())).resolves.toEqual({
      name: 'ops/nightly',
      paused: false,
    });
    expect(fake.row).toMatchObject({
      enabled: false,
      lastSkipReason: null,
      consecutiveFailures: PERMANENT_FAILURES_BEFORE_PAUSE + 1,
    });
    expect(fake.statements).toHaveLength(1);
    expect(createAuditLog).not.toHaveBeenCalled();
    expect(notifyTriggerPaused).not.toHaveBeenCalled();
  });

  it.each(['webhook', 'event'])(
    'keeps counting for a %s binding and never pauses it',
    async (kind) => {
      const fake = fakeTx({
        trigger: schedule(PERMANENT_FAILURES_BEFORE_PAUSE + 3, { kind }),
      });
      await expect(
        recordTriggerRunOutcome(fake.tx, outcome()),
      ).resolves.toEqual({ name: 'ops/nightly', paused: false });
      expect(fake.row).toMatchObject({
        enabled: true,
        consecutiveFailures: PERMANENT_FAILURES_BEFORE_PAUSE + 4,
      });
      expect(fake.statements).toHaveLength(1);
      expect(createAuditLog).not.toHaveBeenCalled();
      expect(notifyTriggerPaused).not.toHaveBeenCalled();
    },
  );
  it('keeps the streak inside a savepoint, and opens none for a run it ignores', async () => {
    const counted = fakeTx({ trigger: schedule(1) });
    await recordTriggerRunOutcome(counted.tx, outcome());
    expect(counted.savepoints).toEqual([1]);

    const ignored = fakeTx({ trigger: schedule(1) });
    await recordTriggerRunOutcome(
      ignored.tx,
      outcome({ failureCode: 'rate_limited' }),
    );
    expect(ignored.savepoints).toEqual([]);
  });

  it('never fails the landing run over its own fault: logged, the run lands', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakeTx({
      trigger: schedule(1),
      countFault: new Error('connection reset'),
    });
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
      trigger: schedule(PERMANENT_FAILURES_BEFORE_PAUSE - 1),
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
