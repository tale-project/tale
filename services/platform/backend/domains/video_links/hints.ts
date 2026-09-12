import type { Sql, TransactionSql } from 'postgres';

import { VIDEO_LINK_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';

/** What a job write hands the hint: the row's identity and its uploader —
 * every write `RETURNING`s these three columns. */
export interface VideoJobHintRow {
  id: string;
  organizationId: string;
  uploadedBy: string;
}

/**
 * Tell the uploader's open tabs that their video-link chips changed — the
 * `/events` hint bridge (`realtime/outbox.ts`), user-targeted because the
 * chips are the sender's composer and no other member reads them. Every
 * write to `app.video_link_jobs` calls this on the handle it wrote with,
 * so inside the transaction where there is one; before it, the chip reads
 * had no signal and polled their route every two seconds on every open
 * chat page, forever. One hint per distinct (organization, uploader) in
 * `rows`: a settle by blob or a watchdog sweep costs one outbox row per
 * affected user, and a single-row write names its job.
 */
export async function hintVideoJobs(
  db: Sql | TransactionSql,
  rows: readonly VideoJobHintRow[],
): Promise<void> {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify([row.organizationId, row.uploadedBy]);
    if (seen.has(key)) continue;
    seen.add(key);
    await emitHintInTx(db, {
      orgId: row.organizationId,
      userId: row.uploadedBy,
      entity: VIDEO_LINK_HINT_ENTITY,
      entityId: rows.length === 1 ? row.id : null,
    });
  }
}
