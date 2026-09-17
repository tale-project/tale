import type { Sql } from 'postgres';

import { cancelDeferredSendsForThread } from './deferred-sends.ts';
import { setThreadArchived, trashThread } from './threads.ts';

/** A snapshot of the caller's visible chat history in this organization.
 * Existing domain verbs retain ownership, audit, busy and legal-hold checks;
 * hidden edit branches follow their root's existing trash cascade. */
export async function bulkUpdateThreads(
  sql: Sql,
  auth: { organizationId: string; userId: string; email?: string },
  operation: 'archive' | 'trash',
): Promise<{ changedIds: string[]; failed: number }> {
  const threads = await sql<{ id: string }[]>`
    SELECT t.id FROM app.threads t
    JOIN app.thread_metadata tm ON tm.thread_id = t.id
    WHERE t.org_id = ${auth.organizationId} AND t.user_id = ${auth.userId}
      AND tm.status = 'active' AND tm.hidden IS NOT true
      AND (${operation} = 'trash' OR tm.archived = false)
    ORDER BY t.id
  `;
  const changedIds: string[] = [];
  let failed = 0;
  for (const { id } of threads) {
    try {
      const changed =
        operation === 'archive'
          ? (await setThreadArchived(sql, auth, id, true)) !== null
          : await trashThread(sql, auth, id);
      if (!changed) {
        failed++;
        continue;
      }
      changedIds.push(id);
    } catch (error) {
      failed++;
      console.warn('[chat] bulk thread action refused', {
        operation,
        threadId: id,
        error,
      });
      continue;
    }
    if (operation === 'trash') {
      try {
        await cancelDeferredSendsForThread(sql, { ...auth, threadId: id });
      } catch (error) {
        // The trash mutation already committed. Keep its result and realtime
        // hint accurate; the deferred-send worker also re-gates trashed threads.
        console.warn('[chat] bulk trash deferred-send cleanup failed', {
          threadId: id,
          error,
        });
      }
    }
  }
  return { changedIds, failed };
}
