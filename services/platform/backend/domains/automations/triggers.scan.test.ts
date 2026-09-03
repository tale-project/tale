// @vitest-environment node

/**
 * Unit lock for the schedule scan's shape (trigger-delivery class): the walk
 * is a keyset over EVERY enabled schedule (pages, not a cap), the due stamp
 * is a conditional CLAIM (a lost claim never reaches beginRun), and the
 * undeployed schedules are summarised in one line, not one per trigger. The
 * real-Postgres probe (`integration-check.ts`) proves the fairness count and
 * the overlapping-scan exactly-once on the actual schema.
 */

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { scanScheduledTriggers } from './triggers.ts';

interface Statement {
  text: string;
  values: unknown[];
}

interface FakeScan {
  sql: Sql;
  statements: Statement[];
  begins: number;
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
    createdAt: now - 600_000,
  };
}

/**
 * Scripted `sql`: page queries pop from `pages`, claim UPDATEs pop from
 * `claims`, and `begin` (what `beginRun` rides) pops from `starts` without
 * touching the run store — the scan's own contract is what is under test.
 */
function fakeScan(script: {
  pages: Record<string, unknown>[][];
  claims: { id: string }[][];
  starts: ({ runId: string; version: number } | null)[];
}): FakeScan {
  const statements: Statement[] = [];
  const state = { begins: 0 };
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('UPDATE app.automation_triggers')) {
      return Promise.resolve(script.claims.shift() ?? []);
    }
    return Promise.resolve(script.pages.shift() ?? []);
  };
  fn.unsafe = (text: string): { text: string } => ({ text });
  fn.begin = (): Promise<unknown> => {
    state.begins++;
    return Promise.resolve(script.starts.shift() ?? null);
  };
  return {
    sql: fn as unknown as Sql,
    statements,
    get begins() {
      return state.begins;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
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
      starts: [{ runId: 'r2', version: 1 }, null, { runId: 'r5', version: 1 }],
    });

    const result = await scanScheduledTriggers(fake.sql, { pageSize: 3 });

    expect(result).toEqual({ examined: 5, fired: 2, pages: 2, undeployed: 1 });
    // Only the WON claims reached beginRun.
    expect(fake.begins).toBe(3);

    const pageQueries = fake.statements.filter((s) =>
      s.text.includes('SELECT'),
    );
    expect(pageQueries).toHaveLength(2);
    for (const query of pageQueries) {
      expect(query.text).toContain('ORDER BY id');
      expect(query.text).toContain("kind = 'schedule' AND enabled = true");
      expect(query.values).toContain(3);
    }
    // The second page starts after the last id of the first.
    expect(pageQueries[0]?.values).toContain(null);
    expect(pageQueries[1]?.values).toContain('t3');

    const claims = fake.statements.filter((s) =>
      s.text.includes('UPDATE app.automation_triggers'),
    );
    expect(claims).toHaveLength(5);
    for (const claim of claims) {
      // Conditional stamp + RETURNING: the loser of an overlapping scan
      // matches nothing and never starts a run.
      expect(claim.text).toContain(
        'last_fired_at_ms IS NULL OR last_fired_at_ms <',
      );
      expect(claim.text).toContain('RETURNING id');
    }

    // One summary line for the undeployed schedule, not one per trigger.
    const summaries = warn.mock.calls.filter((call) =>
      String(call[0]).includes('no deployed version'),
    );
    expect(summaries).toHaveLength(1);
    expect(String(summaries[0]?.[0])).toContain('1 due schedule(s)');
    expect(String(summaries[0]?.[0])).toContain('org_1/sched/t3');
  });

  it('stops after a short page and skips a schedule that is not due', async () => {
    const now = Date.now();
    const notDue = {
      ...triggerRow('t9', now),
      // Stamped this very minute: nothing newer can be due.
      lastFiredAt: Math.floor(now / 60_000) * 60_000,
    };
    const fake = fakeScan({ pages: [[notDue]], claims: [], starts: [] });

    const result = await scanScheduledTriggers(fake.sql, { pageSize: 200 });

    expect(result).toEqual({ examined: 1, fired: 0, pages: 1, undeployed: 0 });
    expect(fake.begins).toBe(0);
    expect(fake.statements).toHaveLength(1);
  });

  it('keeps scanning past a schedule whose cron cannot parse', async () => {
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
      starts: [{ runId: 'r-ok', version: 1 }],
    });

    const result = await scanScheduledTriggers(fake.sql, { pageSize: 200 });

    expect(result).toEqual({ examined: 2, fired: 1, pages: 1, undeployed: 0 });
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes('unusable schedule'),
      ),
    ).toBe(true);
  });
});
