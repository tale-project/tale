// @vitest-environment node

/**
 * Unit lock for the re-attach sweep's listing (bounded-walk class): every
 * predicate — unsettled agent cursor, the awaiting_human exemption, the
 * liveness rule — lives in SQL, and the bound walks the CANDIDATES oldest
 * first. Regression: the sweep paged the 100 NEWEST `waiting` runs of any
 * kind and filtered in JS, so a stalled turn behind enough approval/ask
 * parks or healthy turns was re-skipped every sweep until its deadline. The
 * real-Postgres probe drives the fleet shape over the actual rows.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { recoverStalledWorkflowAgentTurns } from './reattach.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function fakeSql(): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const fn = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    statements.push({ text: strings.join('?'), values });
    return Promise.resolve([]);
  };
  return { sql: fn as unknown as Sql, statements };
}

describe('listStalledWorkflowAgentTurns', () => {
  it('filters in SQL and walks the oldest candidates first', async () => {
    const fake = fakeSql();
    const result = await recoverStalledWorkflowAgentTurns(fake.sql, {
      staleMs: 60_000,
      probe: () => Promise.resolve({ state: 'running' as const }),
    });

    expect(result).toEqual({ examined: 0, resumed: 0 });
    expect(fake.statements).toHaveLength(1);
    const listing = fake.statements[0]?.text ?? '';
    expect(listing).toContain("r.status = 'waiting'");
    // The candidate predicates are the query's, not a JS pass over a page.
    expect(listing).toContain(
      "r.checkpoints -> 'cursor' -> 'agent' -> 'result' IS NULL",
    );
    expect(listing).toContain(
      "op.agent_result_status IS DISTINCT FROM 'awaiting_human'",
    );
    expect(listing).toMatch(/greatest\([\s\S]*heartbeat_at_ms[\s\S]*\) < \?/);
    // Oldest first, bounded by the sweep size only — no scan page.
    expect(listing).toContain('ORDER BY r.started_at_ms ASC');
    expect(listing).not.toMatch(/ORDER BY r\.started_at_ms DESC/);
    expect(fake.statements[0]?.values.at(-1)).toBe(25);
    // The staleness cut is a parameter, evaluated per row in SQL.
    const staleBefore = fake.statements[0]?.values[0];
    expect(staleBefore).toBeTypeOf('number');
    expect(staleBefore as number).toBeLessThanOrEqual(Date.now() - 60_000);
  });
});
