import type { Sql } from 'postgres';

/**
 * The sweep of settled model-endpoint and direct automation LLM requests.
 *
 * Every request through the model endpoints for API keys is one row in
 * `app.sandbox_session_ops` (`kind = 'model-api'` or `automation-llm`), so the
 * table grows by a row per request. The usage ledger is the durable record
 * of a request's spend: the op row only carries the request's budget hold
 * and its virtual key to the settlement. Once both are done — the spend
 * booked (`spend_settled_at_ms`) and the key deleted
 * (`key_revoked_at_ms`), or never minted — the row has nothing left to
 * carry, and a week after the request started it goes.
 *
 * A row still `running`, still holding budget or still naming a live key is
 * never touched: deleting it would drop the hold from the caps, or orphan a
 * key whose spend the settlement has yet to read and book.
 */

/** How long a settled request's op row stays, counted from its start. */
const SETTLED_OP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Rows deleted per statement, and statements per sweep — a backlog beyond
 * one sweep drains over the following ticks instead of in one long run. */
const DEFAULT_BATCH = 1_000;
const DEFAULT_MAX_BATCHES = 20;

/**
 * Delete the op rows of model-endpoint requests that ended, settled and
 * gave their key back more than a week ago, oldest first, batch after batch
 * until one comes back short or `maxBatches` are spent. Each batch is its
 * own statement, so no long transaction holds the table. Returns the rows
 * deleted.
 */
export async function sweepSettledModelApiOps(
  sql: Sql,
  options: { now?: number; batch?: number; maxBatches?: number } = {},
): Promise<number> {
  const batch = options.batch ?? DEFAULT_BATCH;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
  const cutoff = (options.now ?? Date.now()) - SETTLED_OP_RETENTION_MS;
  let deleted = 0;
  for (let round = 0; round < maxBatches; round += 1) {
    // Literal predicates retain both kinds' partial started-at indexes.
    // Each input and the combined result are bounded; the existing total
    // statement/row budget remains shared by both direct-call lanes.
    const rows = await sql<{ id: string }[]>`
      DELETE FROM app.sandbox_session_ops
      WHERE id IN (
        SELECT id FROM (
          (SELECT id, started_at_ms FROM app.sandbox_session_ops
            WHERE kind = 'model-api' AND status <> 'running'
              AND spend_settled_at_ms IS NOT NULL
              AND (key_revoked_at_ms IS NOT NULL OR minted_key_id IS NULL)
              AND started_at_ms < ${cutoff}
            ORDER BY started_at_ms LIMIT ${batch})
          UNION ALL
          (SELECT id, started_at_ms FROM app.sandbox_session_ops
            WHERE kind = 'automation-llm' AND status <> 'running'
              AND spend_settled_at_ms IS NOT NULL
              AND (key_revoked_at_ms IS NOT NULL OR minted_key_id IS NULL)
              AND started_at_ms < ${cutoff}
            ORDER BY started_at_ms LIMIT ${batch})
        ) AS settled_direct_ops
        ORDER BY started_at_ms LIMIT ${batch}
      )
      RETURNING id
    `;
    deleted += rows.length;
    if (rows.length < batch) break;
  }
  return deleted;
}
