import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { recoverStalledTaskAgentTurns } from './reattach.ts';

/**
 * Unit lock for the running-turn sweep's listing predicate: a run with NO op
 * row is only "a start that died before writing one" once its run row has
 * been quiet past the staleness window. A restart-steer rotates the exec
 * (bumping `updated_at_ms`) and writes the new exec's op row only after
 * re-staging — in that gap the run is alive, and claiming it would enqueue a
 * second drive chain on an exec nobody has spawned yet. The real-Postgres
 * proof (a just-rotated op-less run is left alone, a stale one resumes) rides
 * `integration-check.ts`.
 */

function recordingSql(): { sql: Sql; statements: string[] } {
  const statements: string[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ..._values: unknown[]
  ): Promise<unknown[]> => {
    statements.push(strings.join('?').replaceAll(/\s+/g, ' ').trim());
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a one-member stand-in for the postgres.js template function
  return { sql: tag as unknown as Sql, statements };
}

describe('recoverStalledTaskAgentTurns — the op-less arm ages on the run row', () => {
  it('requires the run row itself to be stale before an op-less run counts as abandoned', async () => {
    const { sql, statements } = recordingSql();
    const result = await recoverStalledTaskAgentTurns(sql, {
      probe: () => Promise.resolve({ state: 'running' as const }),
    });
    expect(result).toEqual({ examined: 0, resumed: 0 });
    const listing = statements.find((text) =>
      text.startsWith('SELECT r.id AS "runId"'),
    );
    expect(listing).toBeDefined();
    expect(listing).toContain("r.status = 'running'");
    // The two arms: an op-less run must ALSO be quiet on its run row; a run
    // with an op row is judged on the op's lease alone.
    expect(listing).toContain('(op.id IS NULL AND r.updated_at_ms < ?)');
    expect(listing).toMatch(/OR greatest\( op\.started_at_ms/);
  });
});
