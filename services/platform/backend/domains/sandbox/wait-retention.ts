import type { Sql } from 'postgres';

/**
 * The sweep of what waiting for sandbox room leaves behind.
 *
 * Every start of an automation step that the sandbox refused for want of
 * room writes an op row (its kick) that settles `awaiting_room`, and every
 * create the spawner refused leaves a session row settled `failed` and
 * already collected (nothing exists under its id). A step that waits an
 * hour writes dozens of each, and nothing used to delete them.
 *
 * - An `awaiting_room` op row an hour after it ended goes, unless it is
 *   the newest op of its session: the run view reads that one to say the
 *   step waits. A row that minted a gateway key is never touched — its
 *   settlement still has a key to read and revoke.
 * - A `failed` session row a day after it was collected goes: no compute is
 *   left under it, the cleanup pass that collects failed creates skips it,
 *   and every other reader (the latest incarnation of an id, a recent op's
 *   attribution) looks at newer rows or at rows still holding compute. A
 *   start at the front of the sandbox host's line asks every few seconds,
 *   so a long wait leaves hundreds of them an hour. The newest row of a
 *   project agent's session id stays, though: collecting a failed create of
 *   an agent session stops its compute and keeps its workspace, and the
 *   workspace cleanup finds a project agent's workspace through its rows,
 *   to delete it once unused or with its agent or member. One that no row
 *   names is kept for as long as its agent exists (a restored database may
 *   have lost the row its next run resumes), so deleting the last row would
 *   keep the workspace for good. The row goes once a newer one names the
 *   id. An automation run's rows go regardless: the cleanup deletes a run's
 *   workspace that no row names.
 */

/** How long a refused start's op row stays after it ended. */
const AWAITING_ROOM_OP_RETENTION_MS = 60 * 60 * 1000;
/** How long a failed session row stays after it was collected — a project
 * agent's newest row of its id stays until a newer one follows. */
const COLLECTED_SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Rows deleted per statement, and statements per table per sweep — a
 * backlog beyond one sweep drains over the following ticks instead of in
 * one long run. */
const DEFAULT_BATCH = 1_000;
const DEFAULT_MAX_BATCHES = 10;

/**
 * Delete the op rows of refused starts and the collected failed session
 * rows past their retention, batch after batch per table until one comes
 * back short or `maxBatches` are spent. Each batch is its own statement, so
 * no long transaction holds either table. Returns the rows deleted.
 */
export async function sweepRoomWaitLeftovers(
  sql: Sql,
  options: { now?: number; batch?: number; maxBatches?: number } = {},
): Promise<{ ops: number; sessions: number }> {
  const batch = options.batch ?? DEFAULT_BATCH;
  const maxBatches = options.maxBatches ?? DEFAULT_MAX_BATCHES;
  const now = options.now ?? Date.now();
  const opCutoff = now - AWAITING_ROOM_OP_RETENTION_MS;
  const sessionCutoff = now - COLLECTED_SESSION_RETENTION_MS;
  let ops = 0;
  for (let round = 0; round < maxBatches; round += 1) {
    // `awaiting_room` (`AWAITING_ROOM_RESULT_STATUS`) is written as a
    // literal, never a bound parameter: the planner matches the partial
    // index `sandbox_session_ops_awaiting_room_finished` only against a
    // predicate it can prove.
    const deleted = await sql<{ id: string }[]>`
      DELETE FROM app.sandbox_session_ops
      WHERE id IN (
        SELECT o.id FROM app.sandbox_session_ops o
        WHERE o.agent_result_status = 'awaiting_room'
          AND o.status <> 'running'
          AND o.minted_key_id IS NULL
          AND o.finished_at_ms < ${opCutoff}
          AND EXISTS (
            SELECT 1 FROM app.sandbox_session_ops newer
            WHERE newer.session_id = o.session_id
              AND (newer.started_at_ms, newer.id) > (o.started_at_ms, o.id)
          )
        ORDER BY o.finished_at_ms
        LIMIT ${batch}
      )
      RETURNING id
    `;
    ops += deleted.length;
    if (deleted.length < batch) break;
  }
  let sessions = 0;
  for (let round = 0; round < maxBatches; round += 1) {
    const deleted = await sql<{ id: string }[]>`
      DELETE FROM app.sandbox_sessions
      WHERE id IN (
        SELECT s.id FROM app.sandbox_sessions s
        WHERE s.status = 'failed'
          AND s.destroyed_at_ms IS NOT NULL
          AND s.destroyed_at_ms < ${sessionCutoff}
          AND (
            s.owner_type <> 'project_agent'
            OR EXISTS (
              SELECT 1 FROM app.sandbox_sessions newer
              WHERE newer.session_id = s.session_id
                AND (newer.created_at_ms, newer.id) > (s.created_at_ms, s.id)
            )
          )
        ORDER BY s.destroyed_at_ms
        LIMIT ${batch}
      )
      RETURNING id
    `;
    sessions += deleted.length;
    if (deleted.length < batch) break;
  }
  return { ops, sessions };
}
