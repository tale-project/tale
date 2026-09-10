import type { Sql, TransactionSql } from 'postgres';

/** Admission and release share one per-org transaction lock. Take it before
 * reading owners or counting allocations, so a stale release cannot uncount
 * a turn that has just re-admitted its standing workspace. */
export async function lockOrgAdmission(
  tx: TransactionSql | Sql,
  organizationId: string,
): Promise<void> {
  await tx`
    SELECT pg_advisory_xact_lock(hashtextextended('sandbox:' || ${organizationId}, 0))
  `;
}
