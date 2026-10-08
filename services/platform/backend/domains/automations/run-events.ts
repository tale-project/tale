import type { Sql, TransactionSql } from 'postgres';

import { toJson } from '../../db/sql.ts';
import { engineVersion, instanceId } from '../../lib/instance.ts';

/**
 * What happened to a run between its steps that its checkpoints cannot say
 * (`app.automation_run_events`, migration 0161): a server taking it over
 * after another stopped responding, a hand-off because its server was
 * shutting down, a step interrupted, a write that may already have happened,
 * an engine too old to read its progress.
 *
 * Append-only and written by the store alone, inside the transaction of the
 * state change it explains. Each row names the process that observed it and
 * that process's release; neither ever reaches a client. `detail` carries
 * ids, indices and reasons — never a step's input or output.
 */

export type RunEventKind =
  | 'taken_over'
  | 'handed_off'
  | 'lease_expired'
  | 'node_interrupted'
  | 'in_doubt'
  | 'in_doubt_resolved'
  | 'engine_deferred'
  | 'legacy_stop_requested';

export interface RunEventArgs {
  organizationId: string;
  runId: string;
  kind: RunEventKind;
  detail?: Record<string, unknown>;
  /** Record it only when this release has not recorded the same kind for
   * the run before — a deferral re-tried every few seconds says so once. */
  oncePerEngine?: boolean;
}

/** Append one event to the run's record; answers whether a row was written
 * (false only for a repeat that `oncePerEngine` skipped). */
export async function recordRunEventInTx(
  tx: TransactionSql | Sql,
  args: RunEventArgs,
): Promise<boolean> {
  const version = engineVersion();
  const detail =
    args.detail === undefined ? null : tx.json(toJson(args.detail));
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.automation_run_events (
      run_id, org_id, at_ms, kind, instance, engine_version, detail
    )
    SELECT ${args.runId}::text, ${args.organizationId}::text,
           ${Date.now()}::bigint, ${args.kind}::text, ${instanceId()}::text,
           ${version}::text, ${detail}::jsonb
    WHERE ${args.oncePerEngine !== true}::boolean OR NOT EXISTS (
      SELECT 1 FROM app.automation_run_events
      WHERE run_id = ${args.runId} AND kind = ${args.kind}
        AND engine_version = ${version}
    )
    RETURNING id
  `;
  return rows.length > 0;
}
