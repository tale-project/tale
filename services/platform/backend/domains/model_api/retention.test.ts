/**
 * The sweep of settled model-endpoint requests: only a row that ended,
 * settled its spend and gave its key back (or never minted one) goes, a
 * week after it started; the batch predicate keeps the literal kind the
 * partial index is declared on; and the sweep drains batch after batch
 * until one comes back short or its batch budget is spent.
 */

import { describe, expect, it } from 'vitest';

import { MODEL_API_OP_KIND } from '../../core/sandbox/session_constants.ts';
import { sweepSettledModelApiOps } from './retention.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** A recording `sql` whose DELETE answers the scripted batch sizes in turn
 * (then empty batches). */
function fakeSql(batchSizes: number[]) {
  const statements: Statement[] = [];
  const answers = [...batchSizes];
  const run = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    const size = answers.shift() ?? 0;
    return Promise.resolve(
      Array.from({ length: size }, (_, index) => ({ id: `op-${index}` })),
    );
  };
  return { sql: run as never, statements };
}

const NOW = 1_790_000_000_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

describe('sweepSettledModelApiOps', () => {
  it('deletes only ended, settled, key-returned model-endpoint rows older than a week, oldest first', async () => {
    const { sql, statements } = fakeSql([3]);

    const deleted = await sweepSettledModelApiOps(sql, { now: NOW });

    expect(deleted).toBe(3);
    expect(statements).toHaveLength(1);
    const [statement] = statements;
    for (const kind of ['model-api', 'automation-llm']) {
      expect(statement?.text).toContain(
        `WHERE kind = '${kind}' AND status <> 'running'`,
      );
    }
    expect(
      statement?.text.match(/AND spend_settled_at_ms IS NOT NULL/g),
    ).toHaveLength(2);
    expect(
      statement?.text.match(
        /AND \(key_revoked_at_ms IS NOT NULL OR minted_key_id IS NULL\)/g,
      ),
    ).toHaveLength(2);
    expect(statement?.text).toContain('UNION ALL');
    // The cutoff is a week before the tick; the default batch is 1,000.
    expect(statement?.values).toEqual([
      NOW - WEEK_MS,
      1_000,
      NOW - WEEK_MS,
      1_000,
      1_000,
    ]);
  });

  it('spells the kind as the literal the partial index is declared on, never a bound value', async () => {
    // `sandbox_session_ops_model_api_started` is `WHERE kind = 'model-api'`:
    // the planner only uses it for a predicate it can prove, which a bound
    // parameter is not under a generic plan.
    const { sql, statements } = fakeSql([0]);

    await sweepSettledModelApiOps(sql, { now: NOW });

    expect(statements[0]?.text).toContain(`kind = '${MODEL_API_OP_KIND}'`);
    expect(statements[0]?.values).not.toContain(MODEL_API_OP_KIND);
  });

  it('drains batch after batch until one comes back short, and returns every row deleted', async () => {
    const { sql, statements } = fakeSql([2, 2, 1, 2]);

    const deleted = await sweepSettledModelApiOps(sql, {
      now: NOW,
      batch: 2,
    });

    // The third batch came back short: the sweep stops there, and the
    // fourth answer is never asked for.
    expect(deleted).toBe(5);
    expect(statements).toHaveLength(3);
    for (const statement of statements) {
      expect(statement.values).toEqual([NOW - WEEK_MS, 2, NOW - WEEK_MS, 2, 2]);
    }
  });

  it('stops at its batch budget and leaves the rest of a backlog to the next sweep', async () => {
    const { sql, statements } = fakeSql([2, 2, 2, 2]);

    const deleted = await sweepSettledModelApiOps(sql, {
      now: NOW,
      batch: 2,
      maxBatches: 3,
    });

    expect(deleted).toBe(6);
    expect(statements).toHaveLength(3);
  });

  it('asks once and deletes nothing when no row qualifies', async () => {
    const { sql, statements } = fakeSql([]);

    await expect(sweepSettledModelApiOps(sql, { now: NOW })).resolves.toBe(0);
    expect(statements).toHaveLength(1);
  });

  it('counts the week from the clock when no tick is given', async () => {
    const { sql, statements } = fakeSql([0]);
    const before = Date.now();

    await sweepSettledModelApiOps(sql);

    const cutoff = statements[0]?.values[0];
    expect(typeof cutoff).toBe('number');
    expect(cutoff as number).toBeGreaterThanOrEqual(before - WEEK_MS);
    expect(cutoff as number).toBeLessThanOrEqual(Date.now() - WEEK_MS);
  });
});
