import type { Sql } from 'postgres';

/**
 * The messages among `messageIds` whose `rag.index_message` job is queued:
 * waiting to start or to retry, and with `running` also running. An email
 * body has no status row, so its job is what says it is queued; and the
 * queue's default policy reads a singleton key as a label only
 * (`jobs/tasks.ts`), so the jobs are looked for rather than keyed.
 */
export async function messagesWithIndexJob(
  sql: Sql,
  messageIds: readonly string[],
  options: { running?: boolean } = {},
): Promise<Set<string>> {
  if (messageIds.length === 0) return new Set();
  const rows = await sql<{ messageId: string }[]>`
    SELECT DISTINCT data->>'messageId' AS "messageId"
    FROM pgboss.job
    WHERE name = 'rag.index_message'
      AND (state IN ('created', 'retry')
        OR (${options.running === true} AND state = 'active'))
      AND data->>'messageId' = ANY(${[...messageIds]}::text[])
  `;
  return new Set(rows.map((row) => row.messageId));
}
