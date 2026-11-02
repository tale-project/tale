// @vitest-environment node

/**
 * The fold moves an organization's usage journal into its rollups in one
 * statement, so a journal row is added once and gone with the same commit,
 * and deletes a total only when its ledger rows are all gone. Against a
 * database in `budget-period-sums.integration.ts`.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { foldUsageRollups } from './usage-rollups.ts';

interface Statement {
  text: string;
  values: unknown[];
}

function scriptedSql(fold: unknown[]): { sql: Sql; statements: Statement[] } {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ');
    statements.push({ text, values });
    return Promise.resolve(statements.length === 1 ? fold : []);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the tag call is exercised by the fold
  return { sql: tag as unknown as Sql, statements };
}

describe('foldUsageRollups', () => {
  it('moves the journal into both rollups in one statement and returns the rows it folded', async () => {
    const { sql, statements } = scriptedSql([
      { deltas: 3, emptiedPeriods: [] },
    ]);

    await expect(foldUsageRollups(sql, 'org-1')).resolves.toBe(3);

    expect(statements).toHaveLength(1);
    const [fold] = statements;
    // The journal rows are deleted by the statement that adds them up.
    expect(fold?.text).toContain(
      'WITH journal AS ( DELETE FROM app.usage_period_deltas WHERE org_id = ?',
    );
    expect(fold?.text).toContain(
      'INSERT INTO app.usage_period_subject_totals AS total',
    );
    expect(fold?.text).toContain(
      'ON CONFLICT (org_id, period_key, user_id, api_key_id) DO UPDATE SET',
    );
    expect(fold?.text).toContain(
      'INSERT INTO app.usage_period_totals AS total',
    );
    expect(fold?.text).toContain(
      'ON CONFLICT (org_id, period_key) DO UPDATE SET',
    );
    for (const column of [
      'total_tokens',
      'cost_estimate_cents',
      'request_count',
      'ledger_rows',
    ]) {
      expect(fold?.text).toContain(
        `${column} = total.${column} + EXCLUDED.${column}`,
      );
    }
    expect(fold?.values).toEqual(['org-1', 'org-1', 'org-1']);
  });

  it('deletes the totals whose ledger rows are all gone, of the periods the fold emptied alone', async () => {
    const { sql, statements } = scriptedSql([
      { deltas: 2, emptiedPeriods: ['2026-10'] },
    ]);

    await expect(foldUsageRollups(sql, 'org-1')).resolves.toBe(2);

    expect(statements).toHaveLength(3);
    expect(statements[1]?.text).toContain(
      'DELETE FROM app.usage_period_subject_totals',
    );
    expect(statements[2]?.text).toContain(
      'DELETE FROM app.usage_period_totals',
    );
    for (const prune of statements.slice(1)) {
      // A total some ledger row still holds stays, even at zero.
      expect(prune.text).toContain('AND ledger_rows <= 0');
      expect(prune.values).toEqual(['org-1', ['2026-10']]);
    }
  });

  it('folds nothing when the statement returns no row', async () => {
    const { sql, statements } = scriptedSql([]);

    await expect(foldUsageRollups(sql, 'org-1')).resolves.toBe(0);

    expect(statements).toHaveLength(1);
  });
});
