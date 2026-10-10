// @vitest-environment node

/**
 * Unit lock for the schedule scan (trigger-delivery class). The scan walks
 * two partial indexes by keyset — the schedules whose next instant is not
 * computed yet, then the ones whose instant has come, most overdue first —
 * and decides each schedule in its own transaction from its row as locked
 * then (`FOR UPDATE SKIP LOCKED`): a row another scan or a save holds is
 * left for the next scan, one another scan already moved on starts nothing.
 * At most one occurrence starts — the latest; with `catchUp: 'skip'` only
 * when it is at most ten minutes late — and the others are counted in the
 * skip detail. The run, the stamps, the claim cursor and the next instant
 * share one write in the row's transaction. A refused start keeps its claim
 * and records `start_refused` with the refusal's code, version and
 * problems; an unusable schedule records `unusable_cron` and leaves the
 * walk until it is edited; a schedule whose organization no longer exists
 * is disabled, never run, and named once. The undeployed, refused, disabled
 * and missed are summarised in one line each, even when a walk throws; the
 * process's shutdown stops the scan between schedules; and a worker that
 * finds no `organization` table yet scans nothing. The real-Postgres probes
 * (`integration-check.ts`) prove the index use, the compat trigger and the
 * overlapping-scan exactly-once on the actual schema.
 */

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutomationError, beginRunInTx } from './store.ts';
import { scanScheduledTriggers } from './triggers.ts';

vi.mock('./store.ts', async (original) => ({
  ...(await original<typeof import('./store.ts')>()),
  beginRunInTx: vi.fn(),
}));

interface Statement {
  text: string;
  values: unknown[];
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Thursday, 8 October 2026, 09:00:30 UTC. */
const NOW = Date.UTC(2026, 9, 8, 9, 0, 30);
const NINE = Date.UTC(2026, 9, 8, 9, 0);

/** A schedule row as the scan's lock reads it. */
function scheduleRow(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    organizationId: 'org_1',
    name: `sched/${id}`,
    kind: 'schedule',
    cron: null,
    timezone: 'UTC',
    scheduleRule: {
      repeat: { frequency: 'daily', interval: 1, times: ['09:00'] },
      startDate: '2026-01-01',
    },
    catchUp: null,
    nextDueAt: NINE,
    tokenHash: null,
    event: null,
    enabled: true,
    lastFiredAt: NINE - DAY,
    lastDueAt: NINE - DAY,
    lastSkippedAt: null,
    lastSkipReason: null,
    createdAt: NINE - 30 * DAY,
    updatedAt: NINE - 30 * DAY,
    orgMissing: false,
    ...overrides,
  };
}

interface FakeScan {
  sql: Sql;
  /** Every statement, the transactions' included, in order. */
  statements: Statement[];
  /** The statements of each row's transaction, in order. */
  transactions: Statement[][];
}

/**
 * Scripted `sql`: the `organization` table check answers `organizationTable`
 * (present unless a test says otherwise) and the count behind a missing one
 * `waiting`; walk (a) pops its pages from `unset` and walk (b) from `due`
 * (a page scripted as an Error fails its query); inside a row's transaction
 * the lock answers the row `rows` holds for the id (`'locked'`, or none, is
 * a row another transaction holds), the disable of an orphan pops from
 * `retired`, and every other statement answers no rows. `beginRunInTx` is
 * mocked per test: the scan's own contract is what is under test.
 */
function fakeScan(script: {
  organizationTable?: boolean;
  waiting?: number;
  unset?: (string[] | Error)[];
  due?: (string[] | Error)[];
  rows?: Record<string, Record<string, unknown> | 'locked'>;
  retired?: { organizationId: string; name: string }[][];
}): FakeScan {
  const statements: Statement[] = [];
  const transactions: Statement[][] = [];
  const page = (
    pages: (string[] | Error)[] | undefined,
  ): Promise<unknown[]> => {
    const next = pages?.shift() ?? [];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(
      next.map((id) => ({
        id,
        nextDueAt:
          (script.rows?.[id] as { nextDueAt?: number } | undefined)
            ?.nextDueAt ?? 0,
      })),
    );
  };
  const text = (strings: TemplateStringsArray) =>
    strings.join('?').replace(/\s+/g, ' ').trim();
  const root = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sqlText = text(strings);
    statements.push({ text: sqlText, values });
    if (sqlText.includes('to_regclass')) {
      return Promise.resolve([{ present: script.organizationTable ?? true }]);
    }
    if (sqlText.includes('count(*)')) {
      return Promise.resolve([{ count: script.waiting ?? 0 }]);
    }
    if (sqlText.includes('next_due_at_ms IS NULL')) return page(script.unset);
    if (sqlText.includes('next_due_at_ms <= ?')) return page(script.due);
    return Promise.resolve([]);
  };
  root.unsafe = (raw: string): string => raw;
  root.json = (value: unknown): unknown => value;
  root.begin = async (
    callback: (tx: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    const own: Statement[] = [];
    transactions.push(own);
    const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sqlText = text(strings);
      const statement = { text: sqlText, values };
      statements.push(statement);
      own.push(statement);
      if (sqlText.includes('FOR UPDATE OF t SKIP LOCKED')) {
        // The columns ride as the first value; the id is the last.
        const row = script.rows?.[String(values.at(-1))];
        return Promise.resolve(
          row === undefined || row === 'locked' ? [] : [row],
        );
      }
      if (sqlText.includes('SET enabled = false')) {
        return Promise.resolve(script.retired?.shift() ?? []);
      }
      return Promise.resolve([]);
    };
    tx.unsafe = root.unsafe;
    tx.json = root.json;
    return callback(tx);
  };
  return { sql: root as unknown as Sql, statements, transactions };
}

const walksOf = (fake: FakeScan): Statement[] =>
  fake.statements.filter(
    (s) =>
      s.text.startsWith('SELECT id') &&
      s.text.includes('FROM app.automation_triggers'),
  );
const locksOf = (fake: FakeScan): Statement[] =>
  fake.statements.filter((s) => s.text.includes('FOR UPDATE OF t SKIP LOCKED'));
const retirements = (fake: FakeScan): Statement[] =>
  fake.statements.filter((s) => s.text.includes('SET enabled = false'));
const decisionsOf = (fake: FakeScan): Statement[] =>
  fake.statements.filter((s) =>
    s.text.includes('next_due_at_ms = ?, last_due_at_ms = GREATEST'),
  );
const unusableStamps = (fake: FakeScan): Statement[] =>
  fake.statements.filter((s) =>
    s.text.includes("last_skip_reason = 'unusable_cron'"),
  );
const initializations = (fake: FakeScan): Statement[] =>
  fake.statements.filter(
    (s) =>
      s.text ===
      'UPDATE app.automation_triggers SET next_due_at_ms = ? WHERE id = ?',
  );

/** The one write of a decided schedule, read back by what it sets. */
function decided(statement: Statement | undefined) {
  const v = statement?.values ?? [];
  return {
    next: v[0],
    handledThrough: v[1],
    fired: v[2] === true ? { at: v[3], runId: v[5] } : null,
    skip:
      v[6] === true
        ? {
            at: v[7],
            reason: v[9],
            detail: JSON.parse(String(v[11])) as Record<string, unknown>,
          }
        : null,
    id: v[12],
  };
}

const EMPTY = {
  examined: 0,
  fired: 0,
  pages: 0,
  undeployed: 0,
  refused: 0,
  unusable: 0,
  orphaned: 0,
  initialized: 0,
  missed: 0,
  late: 0,
  busy: 0,
  failed: 0,
};

beforeEach(() => {
  vi.mocked(beginRunInTx).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scanScheduledTriggers', () => {
  it('walks the uncomputed rows, then the due ones by keyset, each on its partial index', async () => {
    const fake = fakeScan({
      unset: [['u1', 'u2'], ['u3']],
      due: [['d1', 'd2'], ['d3']],
      rows: {
        // Not computed and not yet due: the instant is written, nothing runs.
        u1: scheduleRow('u1', { nextDueAt: null, updatedAt: NOW - 10_000 }),
        u2: scheduleRow('u2', { nextDueAt: null, updatedAt: NOW - 10_000 }),
        u3: scheduleRow('u3', { nextDueAt: null, updatedAt: NOW - 10_000 }),
        d1: scheduleRow('d1'),
        d2: scheduleRow('d2'),
        d3: scheduleRow('d3'),
      },
    });
    vi.mocked(beginRunInTx).mockResolvedValue({ runId: 'r', version: 1 });

    const result = await scanScheduledTriggers(fake.sql, {
      pageSize: 2,
      now: NOW,
    });

    expect(result).toEqual({
      ...EMPTY,
      examined: 6,
      fired: 3,
      pages: 4,
      initialized: 3,
    });
    const walks = walksOf(fake);
    expect(walks).toHaveLength(4);
    const [unsetFirst, unsetSecond, dueFirst, dueSecond] = walks;
    for (const walk of [unsetFirst, unsetSecond]) {
      expect(walk?.text).toContain(
        "kind = 'schedule' AND enabled AND next_due_at_ms IS NULL",
      );
      // An unusable schedule stays out of the walk until it is edited.
      expect(walk?.text).toContain(
        "last_skip_reason IS DISTINCT FROM 'unusable_cron'",
      );
      expect(walk?.text).toContain('updated_at_ms > last_skipped_at_ms');
      expect(walk?.text).toContain('ORDER BY id');
    }
    expect(unsetFirst?.values).toEqual([null, null, 2]);
    expect(unsetSecond?.values).toEqual(['u2', 'u2', 2]);
    for (const walk of [dueFirst, dueSecond]) {
      expect(walk?.text).toContain(
        "kind = 'schedule' AND enabled AND next_due_at_ms IS NOT NULL AND next_due_at_ms <= ?",
      );
      expect(walk?.text).toContain('ORDER BY next_due_at_ms, id');
    }
    expect(dueFirst?.values[0]).toBe(NOW);
    expect(dueFirst?.values[1]).toBe(true);
    // The second page starts after the last (instant, id) of the first.
    expect(dueSecond?.values).toEqual([NOW, false, NINE, 'd2', 2]);
    // One transaction per schedule, each opened by the row lock.
    expect(fake.transactions).toHaveLength(6);
    for (const tx of fake.transactions) {
      expect(tx[0]?.text).toContain('WHERE id = ? FOR UPDATE OF t SKIP LOCKED');
      expect(tx[0]?.text).toContain(
        'NOT EXISTS ( SELECT 1 FROM "organization" o WHERE o."id" = t.org_id ) AS "orgMissing"',
      );
    }
    expect(initializations(fake).map((s) => s.values)).toEqual([
      [NINE + DAY, 'u1'],
      [NINE + DAY, 'u2'],
      [NINE + DAY, 'u3'],
    ]);
  });

  it('starts the occurrence that came due, in the row’s transaction, with one write [AUTO-R5]', async () => {
    const fake = fakeScan({ due: [['t1']], rows: { t1: scheduleRow('t1') } });
    vi.mocked(beginRunInTx).mockResolvedValueOnce({ runId: 'r1', version: 3 });

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(result).toMatchObject({ examined: 1, fired: 1, late: 0 });
    expect(beginRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        name: 'sched/t1',
        startedBy: 'trigger:t1',
        mode: 'live',
        input: { trigger: 'schedule', firedAt: NINE },
      }),
    );
    // The run store was handed the row's transaction, not the root handle.
    expect(vi.mocked(beginRunInTx).mock.calls[0]?.[0]).not.toBe(fake.sql);
    const [tx] = fake.transactions;
    expect(tx).toHaveLength(2);
    const write = decided(tx?.[1]);
    expect(write).toEqual({
      next: NINE + DAY,
      handledThrough: NINE,
      fired: { at: NINE, runId: 'r1' },
      skip: null,
      id: 't1',
    });
    // The write names none of the columns the 0170 trigger watches, so it
    // keeps the instant it sets.
    expect(tx?.[1]?.text).not.toMatch(
      /\b(cron|timezone|schedule_rule|enabled|kind) =/,
    );
    expect(tx?.[1]?.text).toContain(
      'last_due_at_ms = GREATEST(COALESCE(last_due_at_ms, 0), ?::bigint)',
    );
  });

  it('leaves a row another scan or a save holds for the next scan', async () => {
    const fake = fakeScan({ due: [['t1']], rows: { t1: 'locked' } });

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(result).toEqual({ ...EMPTY, pages: 2, busy: 1 });
    expect(beginRunInTx).not.toHaveBeenCalled();
    expect(fake.transactions[0]).toHaveLength(1);
  });

  it('starts nothing when the locked row says another scan already moved it on', async () => {
    // Three scans walked the same due row; the first fired it and committed.
    // The others lock it after that commit and read the instant it set.
    const fake = fakeScan({
      due: [['t1']],
      rows: {
        t1: scheduleRow('t1', {
          nextDueAt: NINE + DAY,
          lastDueAt: NINE,
          lastFiredAt: NINE,
        }),
      },
    });

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(result).toEqual({ ...EMPTY, pages: 2, examined: 1 });
    expect(beginRunInTx).not.toHaveBeenCalled();
    expect(decisionsOf(fake)).toHaveLength(0);
    expect(initializations(fake)).toHaveLength(0);
  });

  it('honours an occurrence a previous image already claimed', async () => {
    // Mid-roll, the previous image claimed 09:00 on its cursor and never
    // writes the next instant: the new scan only moves the instant on.
    const fake = fakeScan({
      due: [['t1']],
      rows: { t1: scheduleRow('t1', { lastDueAt: NINE }) },
    });

    await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(beginRunInTx).not.toHaveBeenCalled();
    expect(decided(decisionsOf(fake)[0])).toEqual({
      next: NINE + DAY,
      handledThrough: NINE,
      fired: null,
      skip: null,
      id: 't1',
    });
  });

  it('counts a saved or re-bound schedule from the save, never from before it', async () => {
    // A schedule saved at 09:00:10 — its 09:00 came before the save — is
    // not due until tomorrow, though its cursor is a day old.
    const fake = fakeScan({
      unset: [['t7']],
      rows: {
        t7: scheduleRow('t7', {
          nextDueAt: null,
          lastDueAt: null,
          lastFiredAt: null,
          updatedAt: NINE + 10_000,
        }),
      },
    });

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(result).toMatchObject({ examined: 1, fired: 0, initialized: 1 });
    expect(beginRunInTx).not.toHaveBeenCalled();
    expect(initializations(fake)[0]?.values).toEqual([NINE + DAY, 't7']);
  });

  it('decides an uncomputed row that is already due in the same pass', async () => {
    // A row the previous image wrote at 08:59: no instant, but its 09:00 came.
    const fake = fakeScan({
      unset: [['t1']],
      rows: {
        t1: scheduleRow('t1', {
          cron: '0 9 * * *',
          scheduleRule: null,
          nextDueAt: null,
          updatedAt: NINE - MINUTE,
        }),
      },
    });
    vi.mocked(beginRunInTx).mockResolvedValueOnce({ runId: 'r1', version: 1 });

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(result).toMatchObject({ examined: 1, fired: 1, initialized: 0 });
    expect(decided(decisionsOf(fake)[0])).toMatchObject({
      next: NINE + DAY,
      fired: { at: NINE, runId: 'r1' },
    });
  });

  it('records not_deployed with the occurrence, and summarises it in one line [AUTO-R5]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeScan({ due: [['t3']], rows: { t3: scheduleRow('t3') } });
    vi.mocked(beginRunInTx).mockResolvedValueOnce(null);

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(result).toMatchObject({ fired: 0, undeployed: 1 });
    expect(decided(decisionsOf(fake)[0])).toEqual({
      next: NINE + DAY,
      handledThrough: NINE,
      fired: null,
      skip: {
        at: NOW,
        reason: 'not_deployed',
        detail: { reason: 'not_deployed', occurrence: NINE },
      },
      id: 't3',
    });
    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual([
      '[automations] trigger scan: 1 due schedule(s) have no deployed version to run: org_1/sched/t3',
    ]);
  });

  it('keeps the claim and records start_refused with the code, the version and the problems [AUTO-R6]', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeScan({ due: [['t1']], rows: { t1: scheduleRow('t1') } });
    const issues = Array.from({ length: 12 }, (_, i) => ({
      path: `field${i}`,
      message: 'is required',
    }));
    vi.mocked(beginRunInTx).mockRejectedValueOnce(
      new AutomationError(
        'AUTOMATION_INPUT_INVALID',
        `Run input does not match the automation inputs schema: ${'x'.repeat(600)}`,
        400,
        { issues, version: 4 },
      ),
    );

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(result).toMatchObject({ fired: 0, refused: 1 });
    const write = decided(decisionsOf(fake)[0]);
    // The claim moves on: retrying the same refusal every minute helps
    // nobody.
    expect(write.handledThrough).toBe(NINE);
    expect(write.next).toBe(NINE + DAY);
    expect(write.fired).toBeNull();
    expect(write.skip?.reason).toBe('start_refused');
    const detail = write.skip?.detail as {
      code: string;
      version: number;
      occurrence: number;
      message: string;
      issues: unknown[];
    };
    expect(detail.code).toBe('AUTOMATION_INPUT_INVALID');
    expect(detail.version).toBe(4);
    expect(detail.occurrence).toBe(NINE);
    expect(detail.message).toHaveLength(500);
    expect(detail.issues).toHaveLength(10);
    expect(
      warn.mock.calls.some(
        (call) =>
          String(call[0]).includes('refused by their deployed version') &&
          String(call[0]).includes('org_1/sched/t1 (Run input does not match'),
      ),
    ).toBe(true);
  });

  it('fits a refusal of long, multi-byte problems into its column, problems first', async () => {
    const fake = fakeScan({ due: [['t1']], rows: { t1: scheduleRow('t1') } });
    const issues = Array.from({ length: 10 }, (_, i) => ({
      path: `field${i}`,
      message: 'é'.repeat(800),
    }));
    vi.mocked(beginRunInTx).mockRejectedValueOnce(
      new AutomationError('AUTOMATION_INPUT_INVALID', 'ü'.repeat(900), 400, {
        issues,
        version: 2,
      }),
    );

    await scanScheduledTriggers(fake.sql, { now: NOW });

    const raw = String(decisionsOf(fake)[0]?.values[11]);
    // 0171 caps the column at 8 KiB of jsonb text.
    expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(6144);
    const detail = JSON.parse(raw) as {
      reason: string;
      code: string;
      version: number;
      issues?: unknown[];
      message: string;
    };
    expect(detail).toMatchObject({
      reason: 'start_refused',
      code: 'AUTOMATION_INPUT_INVALID',
      version: 2,
    });
    expect(detail.issues?.length ?? 0).toBeLessThan(10);
    expect(detail.message.length).toBeLessThanOrEqual(500);
  });

  it('keeps an emoji whole where it cuts a refusal, so the stamp stays storable', async () => {
    const fake = fakeScan({ due: [['t1']], rows: { t1: scheduleRow('t1') } });
    // The property name starts at index 56, so the emoji's first half sits
    // at index 498 — exactly where a 500-character sentence is cut.
    const message = `Run input does not match the automation inputs schema: "${'a'.repeat(442)}😀" is required`;
    expect(message.charCodeAt(498)).toBe(0xd83d);
    vi.mocked(beginRunInTx).mockRejectedValueOnce(
      new AutomationError('AUTOMATION_INPUT_INVALID', message, 400, {
        issues: [{ path: `${'b'.repeat(498)}😀`, message: 'is required' }],
        version: 3,
      }),
    );

    await scanScheduledTriggers(fake.sql, { now: NOW });

    const detail = JSON.parse(String(decisionsOf(fake)[0]?.values[11])) as {
      message: string;
      issues: { path: string }[];
    };
    expect(detail.message.isWellFormed()).toBe(true);
    expect(detail.message.endsWith('a…')).toBe(true);
    expect(detail.message.length).toBeLessThanOrEqual(500);
    expect(detail.issues[0]?.path.isWellFormed()).toBe(true);
  });

  it('replaces a lone half the refusal already carried', async () => {
    const fake = fakeScan({ due: [['t1']], rows: { t1: scheduleRow('t1') } });
    vi.mocked(beginRunInTx).mockRejectedValueOnce(
      new AutomationError(
        'AUTOMATION_INPUT_INVALID',
        'broken \ud83d text',
        400,
      ),
    );

    await scanScheduledTriggers(fake.sql, { now: NOW });

    const detail = JSON.parse(String(decisionsOf(fake)[0]?.values[11])) as {
      message: string;
    };
    expect(detail.message).toBe('broken \ufffd text');
  });

  it('isolates a schedule whose transaction fails: the others still fire', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const fake = fakeScan({
      due: [['t1', 't2']],
      rows: { t1: scheduleRow('t1'), t2: scheduleRow('t2') },
    });
    vi.mocked(beginRunInTx)
      .mockRejectedValueOnce(new Error('invalid input syntax for type json'))
      .mockResolvedValueOnce({ runId: 'r2', version: 1 });

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    // The failing row wrote nothing — its transaction rolled back, so it
    // stays due — and the next one fired.
    expect(result).toMatchObject({ examined: 1, fired: 1, failed: 1 });
    const writes = decisionsOf(fake);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.values.at(-1)).toBe('t2');
    expect(
      error.mock.calls.some(
        (call) =>
          String(call[0]).includes('1 schedule(s) failed') &&
          String(call[0]).includes('t1 (invalid input syntax for type json)'),
      ),
    ).toBe(true);
  });

  it('records unusable_cron with its reason for a schedule that cannot be read, and scans on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeScan({
      unset: [['bad', 'zone']],
      due: [['ok']],
      rows: {
        bad: scheduleRow('bad', {
          cron: 'not a cron',
          nextDueAt: null,
        }),
        zone: scheduleRow('zone', {
          timezone: 'Mars/Olympus_Mons',
          nextDueAt: null,
        }),
        ok: scheduleRow('ok'),
      },
    });
    vi.mocked(beginRunInTx).mockResolvedValueOnce({ runId: 'r', version: 1 });

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(result).toMatchObject({ examined: 3, fired: 1, unusable: 2 });
    const stamps = unusableStamps(fake);
    expect(stamps).toHaveLength(2);
    expect(stamps[0]?.text).toContain('SET next_due_at_ms = NULL');
    expect(stamps[0]?.values[0]).toBe(NOW);
    expect(JSON.parse(String(stamps[0]?.values[1]))).toEqual({
      reason: 'unusable_cron',
      message: expect.stringContaining('5 fields'),
    });
    expect(JSON.parse(String(stamps[1]?.values[1]))).toEqual({
      reason: 'unusable_cron',
      message: 'unknown time zone "Mars/Olympus_Mons"',
    });
    expect(
      warn.mock.calls.filter((call) =>
        String(call[0]).includes('unusable schedule'),
      ),
    ).toHaveLength(2);
  });

  it('writes the unusable line once — a row already stamped this hour is stamped again in silence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeScan({
      unset: [['bad']],
      rows: {
        bad: scheduleRow('bad', {
          cron: 'not a cron',
          nextDueAt: null,
          lastSkipReason: 'unusable_cron',
          lastSkippedAt: NOW - 5 * MINUTE,
        }),
      },
    });

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(result.unusable).toBe(1);
    expect(unusableStamps(fake)).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('disables a schedule whose organization is gone — never decided, never run — and names it once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const orphan = (id: string, overrides: Record<string, unknown> = {}) =>
      scheduleRow(id, {
        organizationId: 'org_gone',
        orgMissing: true,
        ...overrides,
      });
    const fake = fakeScan({
      due: [['t1', 't2', 't3', 't4']],
      rows: {
        t1: orphan('t1'),
        t2: scheduleRow('t2'),
        // Nothing about an orphan is read before its organization is: one
        // whose expression cannot parse is disabled all the same.
        t3: orphan('t3', { cron: 'not a cron' }),
        // Another scan's write matched this one first: nothing comes back.
        t4: orphan('t4'),
      },
      retired: [
        [{ organizationId: 'org_gone', name: 'sched/t1' }],
        [{ organizationId: 'org_gone', name: 'sched/t3' }],
        [],
      ],
    });
    vi.mocked(beginRunInTx).mockResolvedValueOnce({ runId: 'r2', version: 1 });

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(result).toMatchObject({ examined: 4, fired: 1, orphaned: 2 });
    expect(beginRunInTx).toHaveBeenCalledTimes(1);
    expect(beginRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'sched/t2' }),
    );
    const retired = retirements(fake);
    expect(retired.map((statement) => statement.values[0])).toEqual([
      ['t1'],
      ['t3'],
      ['t4'],
    ]);
    for (const statement of retired) {
      // It re-checks the organization and the switch at the write.
      expect(statement.text).toContain('t.enabled = true');
      expect(statement.text).toContain(
        'NOT EXISTS ( SELECT 1 FROM "organization" o WHERE o."id" = t.org_id )',
      );
    }
    expect(unusableStamps(fake)).toHaveLength(0);
    const lines = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes('whose organization no longer exists'));
    expect(lines).toEqual([
      '[automations] trigger scan: disabled 2 schedule(s) whose organization no longer exists: org_gone/sched/t1, org_gone/sched/t3',
    ]);
  });

  it('still names what it left undeployed, had refused or disabled when a later walk throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeScan({
      unset: [['t1', 't2', 't3']],
      // The due walk's read dies: the scan fails, and a disabled schedule
      // never enters a walk again — its line is now or never.
      due: [new Error('connection lost')],
      rows: {
        t1: scheduleRow('t1', {
          organizationId: 'org_gone',
          orgMissing: true,
          nextDueAt: null,
        }),
        t2: scheduleRow('t2', { nextDueAt: null, updatedAt: NINE - MINUTE }),
        t3: scheduleRow('t3', { nextDueAt: null, updatedAt: NINE - MINUTE }),
      },
      retired: [[{ organizationId: 'org_gone', name: 'sched/t1' }]],
    });
    vi.mocked(beginRunInTx)
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(
        new AutomationError(
          'AUTOMATION_INPUT_INVALID',
          'Run input does not match the automation inputs schema',
          400,
        ),
      );

    await expect(
      scanScheduledTriggers(fake.sql, { pageSize: 3, now: NOW }),
    ).rejects.toThrow('connection lost');

    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual([
      '[automations] trigger scan: 1 due schedule(s) have no deployed version to run: org_1/sched/t2',
      '[automations] trigger scan: 1 due schedule(s) were refused by their deployed version: org_1/sched/t3 (Run input does not match the automation inputs schema)',
      '[automations] trigger scan: disabled 1 schedule(s) whose organization no longer exists: org_gone/sched/t1',
    ]);
  });

  it('stops between schedules when the process shuts down; the rest stays due', async () => {
    const stop = new AbortController();
    const fake = fakeScan({
      due: [['t1', 't2', 't3']],
      rows: {
        t1: scheduleRow('t1'),
        t2: scheduleRow('t2'),
        t3: scheduleRow('t3'),
      },
    });
    vi.mocked(beginRunInTx).mockImplementation(async () => {
      stop.abort();
      return { runId: 'r1', version: 1 };
    });

    const result = await scanScheduledTriggers(fake.sql, {
      now: NOW,
      signal: stop.signal,
    });

    expect(result).toMatchObject({ examined: 1, fired: 1 });
    expect(locksOf(fake)).toHaveLength(1);
    expect(beginRunInTx).toHaveBeenCalledTimes(1);
  });

  it('starts no walk once shutdown has begun', async () => {
    const stop = new AbortController();
    stop.abort();
    const fake = fakeScan({ due: [['t1']], rows: { t1: scheduleRow('t1') } });

    const result = await scanScheduledTriggers(fake.sql, {
      now: NOW,
      signal: stop.signal,
    });

    expect(result).toEqual(EMPTY);
    expect(walksOf(fake)).toHaveLength(0);
  });

  it('scans nothing, and does not fail, before the organization table exists', async () => {
    // A pure worker on a fresh install runs the minutely scan before an api
    // role has booted and created Better Auth's tables: no table, no
    // organization, so no schedule can be due — and nothing is disabled.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeScan({
      organizationTable: false,
      due: [['t1']],
      rows: { t1: scheduleRow('t1') },
    });

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(result).toEqual(EMPTY);
    expect(fake.statements.map((statement) => statement.text)).toEqual([
      'SELECT to_regclass(\'"organization"\') IS NOT NULL AS present',
      "SELECT count(*)::int AS count FROM app.automation_triggers WHERE kind = 'schedule' AND enabled = true",
    ]);
    expect(beginRunInTx).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('says so when enabled schedules wait but the connection sees no organization table', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = fakeScan({ organizationTable: false, waiting: 3 });

    const result = await scanScheduledTriggers(fake.sql, { now: NOW });

    expect(result).toMatchObject({ examined: 0, fired: 0, pages: 0 });
    expect(walksOf(fake)).toHaveLength(0);
    const lines = warn.mock.calls.map((call) => String(call[0]));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('3 enabled schedule(s) wait');
    expect(lines[0]).toContain('no "organization" table');
  });
});

/**
 * Daylight-saving changes, driven through the scan's clock: a named time
 * the clock skips starts once, moved forward by the gap; one the clock
 * repeats starts once, at its first instant; "every N minutes" keeps its
 * pace in real time, so a repeated quarter hour starts twice.
 */
describe('a schedule through daylight-saving changes [AUTO-R34]', () => {
  const zurich = (
    id: string,
    repeat: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ) =>
    scheduleRow(id, {
      timezone: 'Europe/Zurich',
      scheduleRule: { repeat, startDate: '2026-01-01' },
      nextDueAt: null,
      lastDueAt: null,
      lastFiredAt: null,
      ...overrides,
    });
  const dailyAt = (time: string) => ({
    frequency: 'daily',
    interval: 1,
    times: [time],
  });

  it('starts "every day at 02:30" at 03:30 on the spring-forward day', async () => {
    // 2026-03-29: 02:00 CET jumps to 03:00 CEST; 03:30 CEST is 01:30Z.
    const now = Date.parse('2026-03-29T01:30:30Z');
    const fake = fakeScan({
      unset: [['t1']],
      rows: {
        t1: zurich('t1', dailyAt('02:30'), {
          updatedAt: Date.parse('2026-03-28T12:00:00Z'),
        }),
      },
    });
    vi.mocked(beginRunInTx).mockResolvedValueOnce({ runId: 'r', version: 1 });

    await scanScheduledTriggers(fake.sql, { now });

    expect(decided(decisionsOf(fake)[0])).toMatchObject({
      fired: { at: Date.parse('2026-03-29T01:30:00Z'), runId: 'r' },
      // The next day, 02:30 CEST again.
      next: Date.parse('2026-03-30T00:30:00Z'),
    });
  });

  it('starts "every day at 02:30" once, at the first 02:30, on the fall-back day', async () => {
    // 2026-10-25: 03:00 CEST falls back to 02:00 CET; 02:30 happens at
    // 00:30Z and again at 01:30Z.
    const first = Date.parse('2026-10-25T00:30:00Z');
    const fake = fakeScan({
      due: [['t1']],
      rows: {
        t1: zurich('t1', dailyAt('02:30'), {
          nextDueAt: first,
          lastDueAt: Date.parse('2026-10-24T00:30:00Z'),
        }),
      },
    });
    vi.mocked(beginRunInTx).mockResolvedValueOnce({ runId: 'r', version: 1 });

    await scanScheduledTriggers(fake.sql, { now: first + 30_000 });

    // The second 02:30 is not an occurrence: next is tomorrow's.
    expect(decided(decisionsOf(fake)[0])).toMatchObject({
      fired: { at: first },
      next: Date.parse('2026-10-26T01:30:00Z'),
    });
  });

  it('starts "every 15 minutes" at the repeated 02:45 twice, 15 real minutes apart', async () => {
    const firstPass = Date.parse('2026-10-25T00:45:00Z'); // 02:45 CEST
    const secondPass = Date.parse('2026-10-25T01:45:00Z'); // 02:45 CET
    const quarter = { frequency: 'minutely', interval: 15 };
    const fake = fakeScan({
      due: [['t1'], ['t2']],
      rows: {
        t1: zurich('t1', quarter, {
          nextDueAt: firstPass,
          lastDueAt: firstPass - 15 * MINUTE,
        }),
        t2: zurich('t2', quarter, {
          nextDueAt: secondPass,
          lastDueAt: secondPass - 15 * MINUTE,
        }),
      },
    });
    vi.mocked(beginRunInTx).mockResolvedValue({ runId: 'r', version: 1 });

    await scanScheduledTriggers(fake.sql, { now: firstPass + 30_000 });
    await scanScheduledTriggers(fake.sql, { now: secondPass + 30_000 });

    const [one, two] = decisionsOf(fake).map(decided);
    expect(one).toMatchObject({
      fired: { at: firstPass },
      next: firstPass + 15 * MINUTE, // 02:00 CET
    });
    expect(two).toMatchObject({
      fired: { at: secondPass },
      next: secondPass + 15 * MINUTE, // 03:00 CET
    });
  });
});

/**
 * What a schedule does with occurrences it missed while the platform was
 * not running: `latest` (the default) starts the most recent one once,
 * however late; `skip` starts it only when it is at most ten minutes late.
 * The others are counted in `missed_occurrences`, never run; a fire's own
 * outcome wins over the count, which rides in its detail.
 */
describe('missed occurrences [AUTO-R37]', () => {
  // A daily 09:00 schedule, down from 08:30 on the 6th until 10:15 on the
  // 8th: the 6th, 7th and 8th at 09:00 came due while nothing ran.
  const sixth = NINE - 2 * DAY;
  const back = NINE + 75 * MINUTE;
  const missedRow = (catchUp: 'latest' | 'skip' | null) =>
    scheduleRow('t1', {
      catchUp,
      nextDueAt: sixth,
      lastDueAt: sixth - DAY,
      lastFiredAt: sixth - DAY,
    });

  it('latest: starts the 09:00 of today at 10:15, once, and counts the two before it', async () => {
    const fake = fakeScan({ due: [['t1']], rows: { t1: missedRow(null) } });
    vi.mocked(beginRunInTx).mockResolvedValueOnce({ runId: 'r', version: 1 });

    const result = await scanScheduledTriggers(fake.sql, { now: back });

    expect(result).toMatchObject({ fired: 1, late: 1, missed: 2 });
    expect(beginRunInTx).toHaveBeenCalledTimes(1);
    expect(decided(decisionsOf(fake)[0])).toEqual({
      next: NINE + DAY,
      handledThrough: NINE,
      fired: { at: NINE, runId: 'r' },
      skip: {
        at: back,
        reason: 'missed_occurrences',
        detail: {
          reason: 'missed_occurrences',
          missed: {
            count: 2,
            capped: false,
            firstAt: sixth,
            lastAt: sixth + DAY,
            policy: 'latest',
          },
          firedLatest: true,
        },
      },
      id: 't1',
    });
  });

  it('skip: starts nothing 75 minutes late, and counts all three', async () => {
    const fake = fakeScan({ due: [['t1']], rows: { t1: missedRow('skip') } });

    const result = await scanScheduledTriggers(fake.sql, { now: back });

    expect(result).toMatchObject({ fired: 0, missed: 3 });
    expect(beginRunInTx).not.toHaveBeenCalled();
    expect(decided(decisionsOf(fake)[0])).toMatchObject({
      next: NINE + DAY,
      handledThrough: NINE,
      fired: null,
      skip: {
        reason: 'missed_occurrences',
        detail: {
          reason: 'missed_occurrences',
          missed: { count: 3, firstAt: sixth, lastAt: NINE, policy: 'skip' },
          firedLatest: false,
        },
      },
    });
  });

  it('skip: still starts an occurrence that is at most ten minutes late', async () => {
    const fake = fakeScan({
      due: [['t1']],
      rows: { t1: scheduleRow('t1', { catchUp: 'skip' }) },
    });
    vi.mocked(beginRunInTx).mockResolvedValueOnce({ runId: 'r', version: 1 });

    const result = await scanScheduledTriggers(fake.sql, {
      now: NINE + 10 * MINUTE,
    });

    expect(result).toMatchObject({ fired: 1, late: 0, missed: 0 });
  });

  it('lets the fire’s own outcome win, with the missed count in its detail', async () => {
    const fake = fakeScan({ due: [['t1']], rows: { t1: missedRow(null) } });
    vi.mocked(beginRunInTx).mockResolvedValueOnce(null);

    await scanScheduledTriggers(fake.sql, { now: back });

    expect(decided(decisionsOf(fake)[0]).skip).toEqual({
      at: back,
      reason: 'not_deployed',
      detail: {
        reason: 'not_deployed',
        occurrence: NINE,
        missed: {
          count: 2,
          capped: false,
          firstAt: sixth,
          lastAt: sixth + DAY,
          policy: 'latest',
        },
      },
    });
  });
});
