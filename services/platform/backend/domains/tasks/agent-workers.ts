import type { TransactionSql } from 'postgres';

import { projectAgentWorker } from '../../core/sandbox/session_naming.ts';

/**
 * Give a run's worker back: the run names its family's first worker again
 * (the provisional workspace a kick writes) and holds no claim. Every park
 * does it in the park's own transaction, on the row it just parked, so a
 * parked run never keeps a worker another run could use, and an image that
 * knows nothing of workers wakes it into the family's first workspace, as it
 * always did.
 */
export async function releaseRunWorker(
  tx: TransactionSql,
  runId: string,
): Promise<void> {
  const rows = await tx<{ agentId: string; sessionId: string }[]>`
    SELECT agent_id AS "agentId", session_id AS "sessionId"
    FROM app.project_agent_runs WHERE id = ${runId}
  `;
  const run = rows[0];
  if (run === undefined) return;
  const base =
    projectAgentWorker(run.agentId, run.sessionId)?.base ?? run.sessionId;
  await tx`
    UPDATE app.project_agent_runs SET
      session_id = ${base}, session_claimed_at_ms = NULL
    WHERE id = ${runId}
  `;
}
