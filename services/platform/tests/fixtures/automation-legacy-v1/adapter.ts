import type { Sql, TransactionSql } from 'postgres';

/** Only the columns the retained legacy functions read. No admission,
 * protocol marker, retry, affected-row interpretation or error conversion. */
export async function runRow(
  sql: Sql | TransactionSql,
  organizationId: string,
  runId: string,
): Promise<{
  status: string;
  claimEpoch: number;
  checkpoints: unknown;
} | null> {
  const rows = await sql<
    { status: string; claimEpoch: number; checkpoints: unknown }[]
  >`
    SELECT status, claim_epoch AS "claimEpoch", checkpoints
    FROM app.automation_runs
    WHERE org_id = ${organizationId} AND id = ${runId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Realtime publication is outside this legacy SQL/continuation proof. */
export async function emitRunHint(
  _sql: Sql | TransactionSql,
  _organizationId: string,
  _runId: string,
): Promise<void> {}
