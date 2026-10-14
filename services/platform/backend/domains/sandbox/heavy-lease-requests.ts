import type { TransactionSql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';

/**
 * Asking for the release of a run's heavy-phase leases
 * (`heavy-leases.ts`). Kept apart from the leases' other modules so the
 * place every run ends can ask without importing the spawner client.
 */

/** A lease the release job ends on the sandbox host, as the run's
 * transaction read it. */
export interface HeldLease {
  leaseId: string;
  sessionId: string;
}

/**
 * Ask for the release of every lease the run still holds, in the
 * transaction that ends it — a no-op for the many runs that took none. The
 * job carries the leases as this transaction reads them, so a run whose
 * rows go with it (its task deleted in the same transaction) still has its
 * leases ended on the host.
 */
export async function requestRunLeaseReleaseInTx(
  tx: TransactionSql,
  args: { organizationId: string; runId: string },
): Promise<void> {
  const held = await tx<HeldLease[]>`
    SELECT lease_id AS "leaseId", session_id AS "sessionId"
    FROM app.sandbox_heavy_leases
    WHERE org_id = ${args.organizationId} AND run_id = ${args.runId}
      AND released_at_ms IS NULL
  `;
  if (held.length === 0) return;
  await addJobInTx(
    tx,
    'sandbox.release_run_leases',
    {
      organizationId: args.organizationId,
      runId: args.runId,
      leases: held.map(({ leaseId, sessionId }) => ({ leaseId, sessionId })),
    },
    { singletonKey: `run-leases:${args.runId}` },
  );
}
