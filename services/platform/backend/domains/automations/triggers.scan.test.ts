// @vitest-environment node

/**
 * Unit lock for the schedule scan's shape (trigger-delivery class): the walk
 * is a keyset over EVERY enabled schedule (pages, not a cap); the due stamp
 * is a conditional CLAIM on the ledger's cursor (a lost claim never reaches
 * the run store); the claim, the run and the fire stamp share ONE
 * transaction, so `lastFiredAt` and `lastRunId` move only when a run was
 * inserted and an undeployed automation records a skip instead; a refused
 * start keeps its claim and records `start_refused`; an unusable expression
 * records `unusable_cron` and is left out of the next page; and the
 * undeployed schedules are summarised in one line, not one per trigger. The
 * real-Postgres probe (`integration-check.ts`) proves the fairness count and
 * the overlapping-scan exactly-once on the actual schema.
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

interface FakeScan {
  sql: Sql;
  /** Every statement, the transaction's included, in order. */
  statements: Statement[];
  /** The statements of each transaction, in order. */
  transactions: Statement[][];
}

function triggerRow(id: string, now: number): Record<string, unknown> {
  return {
    id,
    organizationId: 'org_1',
    name: `sched/${id}`,
    kind: 'schedule',
    cron: '* * * * *',
    timezone: 'UTC',
    tokenHash: null,
    event: null,
    enabled: true,
    lastFiredAt: now - 120_000,
    lastDueAt: now - 120_000,
    lastSkippedAt: null,
    lastSkipReason: null,
    createdAt: now - 600_000,
    updatedAt: now - 600_000,
  };
}

/**
 * Scripted `sql`: page queries pop from `pages`; inside `begin` the claim
 * UPDATE pops from `claims` and every other statement answers no rows;
 * `beginRunInTx` is mocked per test. The scan's own contract is what is
 * under test — the run store's is its own.
 */
function fakeScan(script: {
  pages: Record<string, unknown>[][];
  claims: { id: string }[][];
}): FakeScan {
  const statements: Statement[] = [];
  const transactions: Statement[][] = [];
  const root = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.startsWith('SELECT')) {
      return Promise.resolve(script.pages.shift() ?? []);
    }
    return Promise.resolve([]);
  };
  root.unsafe = (text: string): string => text;
  root.begin = (
    callback: (tx: unknown) => Promise<unknown>,
  ): Promise<unknown> => {
    const own: Statement[] = [];
    transactions.push(own);
    const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      const statement = { text, values };
      statements.push(statement);
      own.push(statement);
      if (text.includes('SET last_due_at_ms')) {
        return Promise.resolve(script.claims.shift() ?? []);
      }
      return Promise.resolve([]);
    };
    return callback(tx);
  };
  return { sql: root as unknown as Sql, statements, transactions };
}

const claimsOf = (fake: FakeScan): Statement[] =>
  fake.statements.filter((s) => s.text.includes('SET last_due_at_ms'));
const fireStamps = (fake: FakeScan): Statement[] =>
  fake.statements.filter((s) => s.text.includes('SET last_fired_at_ms'));
const skipStamps = (fake: FakeScan): Statement[] =>
  fake.statements.filter((s) => s.text.includes('SET last_skipped_at_ms'));

beforeEach(() => {
  vi.mocked(beginRunInTx).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('scanScheduledTriggers', () => {
  it('walks every page by keyset, claims each due occurrence once, and summarises the undeployed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const now = Date.now();
    const fake = fakeScan({
      pages: [
        [triggerRow('t1', now), triggerRow('t2', now), triggerRow('t3', now)],
        [triggerRow('t4', now), triggerRow('t5', now)],
      ],
      // t1 and t4: another scan claimed first. t2/t5: claimed → run. t3:
      // claimed → no deployed version.
      claims: [[], [{ id: 't2' }], [{ id: 't3' }], [], [{ id: 't5' }]],
    });
    vi.mocked(beginRunInTx)
      .mockResolvedValueOnce({ runId: 'r2', version: 1 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ runId: 'r5', version: 1 });

    const result = await scanScheduledTriggers(fake.sql, { pageSize: 3 });

    expect(result).toEqual({
      examined: 5,
      fired: 2,
      pages: 2,
      undeployed: 1,
      refused: 0,
      unusable: 0,
    });
    // Only the WON claims reached the run store.
    expect(beginRunInTx).toHaveBeenCalledTimes(3);
    expect(beginRunInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'sched/t2',
        startedBy: 'trigger:t2',
        mode: 'live',
        input: { trigger: 'schedule', firedAt: expect.any(Number) },
      }),
    );

    const pageQueries = fake.statements.filter((s) =>
      s.text.startsWith('SELECT'),
    );
    expect(pageQueries).toHaveLength(2);
    for (const query of pageQueries) {
      expect(query.text).toContain('ORDER BY id');
      expect(query.text).toContain("kind = 'schedule' AND enabled = true");
      // The cursor is the later of the claim and the fire stamp — a
      // previous image claims on the fire stamp alone during a roll.
      expect(query.text).toContain(
        'GREATEST(last_due_at_ms, last_fired_at_ms) IS NULL',
      );
      // An unusable schedule stays out of the page until it is edited.
      expect(query.text).toContain(
        "last_skip_reason IS DISTINCT FROM 'unusable_cron'",
      );
      expect(query.text).toContain('updated_at_ms > last_skipped_at_ms');
      expect(query.values).toContain(3);
    }
    // The second page starts after the last id of the first.
    expect(pageQueries[0]?.values).toContain(null);
    expect(pageQueries[1]?.values).toContain('t3');

    const claims = claimsOf(fake);
    expect(claims).toHaveLength(5);
    for (const claim of claims) {
      // Conditional stamp + RETURNING on the ledger's cursor: the loser of
      // an overlapping scan matches nothing and never starts a run.
      expect(claim.text).toContain(
        'GREATEST(last_due_at_ms, last_fired_at_ms) < ?',
      );
      expect(claim.text).toContain('RETURNING id');
      expect(claim.text).not.toContain('last_fired_at_ms =');
    }

    // The fire stamp names the run, and lands only where a run was
    // inserted; the undeployed claim records a skip instead.
    const fired = fireStamps(fake);
    expect(fired).toHaveLength(2);
    expect(fired[0]?.text).toContain('last_run_id = ?');
    expect(fired[0]?.values).toEqual([expect.any(Number), 'r2', 't2']);
    expect(fired[1]?.values).toEqual([expect.any(Number), 'r5', 't5']);
    const skipped = skipStamps(fake);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.values).toEqual([
      expect.any(Number),
      'not_deployed',
      't3',
    ]);

    // One summary line for the undeployed schedule, not one per trigger.
    const summaries = warn.mock.calls.filter((call) =>
      String(call[0]).includes('no deployed version'),
    );
    expect(summaries).toHaveLength(1);
    expect(String(summaries[0]?.[0])).toContain('1 due schedule(s)');
    expect(String(summaries[0]?.[0])).toContain('org_1/sched/t3');
  });

  it('commits the claim, the run and the fire stamp as one transaction', async () => {
    const now = Date.now();
    const fake = fakeScan({
      pages: [[triggerRow('t1', now)]],
      claims: [[{ id: 't1' }]],
    });
    vi.mocked(beginRunInTx).mockResolvedValueOnce({ runId: 'r1', version: 1 });

    await scanScheduledTriggers(fake.sql, { pageSize: 200 });

    expect(fake.transactions).toHaveLength(1);
    const [tx] = fake.transactions;
    expect(tx?.map((s) => /SET (\w+)/.exec(s.text)?.[1])).toEqual([
      'last_due_at_ms',
      'last_fired_at_ms',
    ]);
    // The run store was handed the transaction, not the root handle.
    expect(vi.mocked(beginRunInTx).mock.calls[0]?.[0]).not.toBe(fake.sql);
    // The stamp is the claimed occurrence — the minute the cron named.
    const claim = tx?.[0];
    const stamp = tx?.[1];
    expect(stamp?.values[0]).toBe(claim?.values[0]);
  });

  it('keeps the claim and records start_refused when the deployed version refuses the input', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const now = Date.now();
    const fake = fakeScan({
      pages: [[triggerRow('t1', now)]],
      claims: [[{ id: 't1' }]],
    });
    vi.mocked(beginRunInTx).mockRejectedValueOnce(
      new AutomationError(
        'AUTOMATION_INPUT_INVALID',
        'Run input does not match the automation inputs schema: "trigger" must be a number',
        400,
      ),
    );

    const result = await scanScheduledTriggers(fake.sql, { pageSize: 200 });

    expect(result).toMatchObject({ fired: 0, undeployed: 0, refused: 1 });
    expect(fireStamps(fake)).toHaveLength(0);
    const skipped = skipStamps(fake);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.values).toEqual([
      expect.any(Number),
      'start_refused',
      't1',
    ]);
    // Inside the transaction, after the claim: the claim is kept, so the
    // next tick does not retry the same refusal.
    expect(
      fake.transactions[0]?.map((s) => /SET (\w+)/.exec(s.text)?.[1]),
    ).toEqual(['last_due_at_ms', 'last_skipped_at_ms']);
    expect(
      warn.mock.calls.some(
        (call) =>
          String(call[0]).includes('refused by their deployed version') &&
          String(call[0]).includes('"trigger" must be a number'),
      ),
    ).toBe(true);
  });

  it('lets a failure that is not a refusal fail the transaction', async () => {
    const now = Date.now();
    const fake = fakeScan({
      pages: [[triggerRow('t1', now)]],
      claims: [[{ id: 't1' }]],
    });
    vi.mocked(beginRunInTx).mockRejectedValueOnce(new Error('connection lost'));

    await expect(
      scanScheduledTriggers(fake.sql, { pageSize: 200 }),
    ).rejects.toThrow('connection lost');
    expect(skipStamps(fake)).toHaveLength(0);
  });

  it('stops after a short page and skips a schedule that is not due', async () => {
    const now = Date.now();
    const notDue = {
      ...triggerRow('t9', now),
      // Claimed this very minute: nothing newer can be due.
      lastFiredAt: null,
      lastDueAt: Math.floor(now / 60_000) * 60_000,
    };
    const fake = fakeScan({ pages: [[notDue]], claims: [] });

    const result = await scanScheduledTriggers(fake.sql, { pageSize: 200 });

    expect(result).toEqual({
      examined: 1,
      fired: 0,
      pages: 1,
      undeployed: 0,
      refused: 0,
      unusable: 0,
    });
    expect(beginRunInTx).not.toHaveBeenCalled();
    expect(fake.statements).toHaveLength(1);
  });

  it('counts a re-bound schedule from its bind, never from the row’s creation', async () => {
    // A trigger re-bound as a schedule has its ledger cleared (the kind
    // changed), so "since" is the bind itself: an occurrence between the
    // row's creation and the bind must not fire. Pinned 30 s past a
    // minute boundary, with the bind 10 s past it: the boundary's
    // occurrence precedes the bind.
    vi.useFakeTimers();
    const boundary = Date.UTC(2026, 8, 11, 10, 0, 0);
    vi.setSystemTime(boundary + 30_000);
    const rebound = {
      ...triggerRow('t7', boundary),
      lastFiredAt: null,
      lastDueAt: null,
      createdAt: boundary - 600_000,
      updatedAt: boundary + 10_000,
    };
    const fake = fakeScan({ pages: [[rebound]], claims: [] });

    const result = await scanScheduledTriggers(fake.sql, { pageSize: 200 });

    expect(result).toMatchObject({ examined: 1, fired: 0, undeployed: 0 });
    expect(beginRunInTx).not.toHaveBeenCalled();
    expect(claimsOf(fake)).toHaveLength(0);
  });

  it('records unusable_cron for a schedule whose cron cannot parse, and scans on', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const now = Date.now();
    const fake = fakeScan({
      pages: [
        [
          { ...triggerRow('bad', now), cron: 'not a cron' },
          triggerRow('ok', now),
        ],
      ],
      claims: [[{ id: 'ok' }]],
    });
    vi.mocked(beginRunInTx).mockResolvedValueOnce({
      runId: 'r-ok',
      version: 1,
    });

    const result = await scanScheduledTriggers(fake.sql, { pageSize: 200 });

    expect(result).toEqual({
      examined: 2,
      fired: 1,
      pages: 1,
      undeployed: 0,
      refused: 0,
      unusable: 1,
    });
    const skipped = skipStamps(fake);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.values).toEqual([
      expect.any(Number),
      'unusable_cron',
      'bad',
    ]);
    // Outside any transaction — nothing to claim for it.
    expect(fake.transactions).toHaveLength(1);
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes('unusable schedule'),
      ),
    ).toBe(true);
  });

  it('writes the unusable line once — a row already stamped this hour is stamped again in silence', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const now = Date.now();
    const fake = fakeScan({
      pages: [
        [
          {
            ...triggerRow('bad', now),
            cron: 'not a cron',
            lastSkipReason: 'unusable_cron',
            lastSkippedAt: now - 5 * 60_000,
          },
        ],
      ],
      claims: [],
    });

    const result = await scanScheduledTriggers(fake.sql, { pageSize: 200 });

    expect(result.unusable).toBe(1);
    expect(skipStamps(fake)).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
