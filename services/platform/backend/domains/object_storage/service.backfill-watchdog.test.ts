import { describe, expect, it } from 'vitest';

import { recoverStuckBackfills } from './service.ts';

/**
 * Unit lock for the backfill crash-recovery waker (job-liveness class): a
 * stalled `running` backfill must be flipped to an HONEST terminal `failed`
 * state (with a watchdog reason) so the one-running partial index stops
 * blocking future backfills. The real-Postgres proof (the stale-window scan
 * and the re-run unblock) rides `integration-check.ts`.
 */

function capturingSql(
  script: unknown[][],
  queries: string[],
  // oxlint-disable-next-line typescript/no-explicit-any -- test double for the postgres.js tag
): any {
  let i = 0;
  return (strings: TemplateStringsArray): Promise<unknown[]> => {
    if (Array.isArray(strings)) queries.push(strings.join('?'));
    return Promise.resolve(i < script.length ? (script[i++] ?? []) : []);
  };
}

describe('recoverStuckBackfills', () => {
  it('flips stalled running backfills to a failed terminal state', async () => {
    const queries: string[] = [];
    const sql = capturingSql([[{ id: 'run_1' }, { id: 'run_2' }]], queries);

    const result = await recoverStuckBackfills(sql, { staleMs: 1_000 });

    expect(result).toEqual({ failed: 2 });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('object_storage_backfill_runs');
    expect(queries[0]).toContain("status = 'failed'");
    // The status UI shows the reason; it must be present, not a bare flip.
    expect(queries[0]).toContain('last_error');
  });

  it('reports zero when nothing is stalled', async () => {
    const queries: string[] = [];
    const sql = capturingSql([[]], queries);

    const result = await recoverStuckBackfills(sql);

    expect(result).toEqual({ failed: 0 });
  });
});
