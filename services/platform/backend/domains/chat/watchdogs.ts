import type { Sql } from 'postgres';

/**
 * Direct-chat crash recovery (2 min) — the 0.5 twin of 0.4's stale-
 * generation sweep: a hard-killed turn strands its generation row with a
 * stale heartbeat, which wedges the thread's composer (the row's existence
 * IS the "generating" signal). Clear the row, settle the thread sidecar
 * back to idle, and fail any still-pending assistant placeholder so the
 * reader renders a terminal state instead of an eternal spinner.
 */
export async function runChatGenerationWatchdog(
  sql: Sql,
  options: { staleMs?: number } = {},
): Promise<number> {
  const staleBefore = Date.now() - (options.staleMs ?? 10 * 60_000);
  const cleared = await sql<{ threadId: string }[]>`
    DELETE FROM app.generations
    WHERE heartbeat_at_ms < ${staleBefore}
    RETURNING thread_id AS "threadId"
  `;
  for (const row of cleared) {
    await sql`
      UPDATE app.thread_metadata SET
        generation_status = 'idle', stream_id = NULL,
        generation_start_ms = NULL, generation_heartbeat_at_ms = NULL,
        generation_queued_since_ms = NULL
      WHERE thread_id = ${row.threadId}
    `;
    await sql`
      UPDATE app.messages SET status = 'failed',
        error = coalesce(error, 'the turn was interrupted by a restart')
      WHERE thread_id = ${row.threadId} AND status = 'pending'
    `;
  }
  return cleared.length;
}
