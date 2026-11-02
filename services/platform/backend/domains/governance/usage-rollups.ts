import type { Sql, TransactionSql } from 'postgres';

/**
 * The usage rollups the budget gate reads (`0235_usage_period_rollups.sql`):
 * per period, an organization's totals (`app.usage_period_totals`) and each
 * ledger subject's and key's (`app.usage_period_subject_totals`). The
 * ledger's own triggers journal every change of its rows into
 * `app.usage_period_deltas`; a fold moves an organization's journal into its
 * totals. The gate reads the totals and the journal rows not folded yet in
 * one statement, so a fold changes how much it reads, never what it sums.
 *
 * Every fold of an organization runs under its admission lock
 * (`lockBudgetAdmission`, `foldBudgetUsage`, `foldPendingBudgetUsage` in
 * `budget-reservations.ts`), so two folds never add the same journal row.
 */

interface FoldRow {
  deltas: number;
  emptiedPeriods: string[] | null;
}

/**
 * Fold an organization's journal into its totals: the journal rows are
 * deleted in the statement that adds them, so a row is folded once. A total
 * whose ledger rows are all gone (erasure, retention, teardown) is deleted,
 * so no rollup keeps a person's id after their ledger rows. The caller holds
 * the organization's admission lock. Returns the journal rows folded.
 */
export async function foldUsageRollups(
  tx: Sql | TransactionSql,
  organizationId: string,
): Promise<number> {
  const [folded] = await tx<FoldRow[]>`
    WITH journal AS (
      DELETE FROM app.usage_period_deltas
      WHERE org_id = ${organizationId}
      RETURNING period_key, user_id, api_key_id, total_tokens,
                cost_estimate_cents, request_count, ledger_rows
    ),
    subjects AS (
      INSERT INTO app.usage_period_subject_totals AS total (
        org_id, period_key, user_id, api_key_id,
        total_tokens, cost_estimate_cents, request_count, ledger_rows
      )
      SELECT ${organizationId}, period_key, user_id, api_key_id,
             sum(total_tokens), sum(cost_estimate_cents), sum(request_count),
             sum(ledger_rows)
      FROM journal
      GROUP BY period_key, user_id, api_key_id
      ON CONFLICT (org_id, period_key, user_id, api_key_id) DO UPDATE SET
        total_tokens = total.total_tokens + EXCLUDED.total_tokens,
        cost_estimate_cents = total.cost_estimate_cents + EXCLUDED.cost_estimate_cents,
        request_count = total.request_count + EXCLUDED.request_count,
        ledger_rows = total.ledger_rows + EXCLUDED.ledger_rows
      RETURNING total.period_key, total.ledger_rows
    ),
    periods AS (
      INSERT INTO app.usage_period_totals AS total (
        org_id, period_key,
        total_tokens, cost_estimate_cents, request_count, ledger_rows
      )
      SELECT ${organizationId}, period_key,
             sum(total_tokens), sum(cost_estimate_cents), sum(request_count),
             sum(ledger_rows)
      FROM journal
      GROUP BY period_key
      ON CONFLICT (org_id, period_key) DO UPDATE SET
        total_tokens = total.total_tokens + EXCLUDED.total_tokens,
        cost_estimate_cents = total.cost_estimate_cents + EXCLUDED.cost_estimate_cents,
        request_count = total.request_count + EXCLUDED.request_count,
        ledger_rows = total.ledger_rows + EXCLUDED.ledger_rows
      RETURNING total.period_key, total.ledger_rows
    )
    SELECT (SELECT count(*) FROM journal)::int AS deltas,
           ARRAY(
             SELECT period_key FROM subjects WHERE ledger_rows <= 0
             UNION
             SELECT period_key FROM periods WHERE ledger_rows <= 0
           ) AS "emptiedPeriods"
  `;
  const emptiedPeriods = folded?.emptiedPeriods ?? [];
  if (emptiedPeriods.length > 0) {
    // A separate statement: the one above cannot see the rows it upserted.
    await tx`
      DELETE FROM app.usage_period_subject_totals
      WHERE org_id = ${organizationId} AND period_key = ANY(${emptiedPeriods})
        AND ledger_rows <= 0
    `;
    await tx`
      DELETE FROM app.usage_period_totals
      WHERE org_id = ${organizationId} AND period_key = ANY(${emptiedPeriods})
        AND ledger_rows <= 0
    `;
  }
  return folded?.deltas ?? 0;
}
