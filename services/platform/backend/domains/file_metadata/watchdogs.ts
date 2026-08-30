import type { Sql } from 'postgres';

import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
} from '../../../convex/knowledge/pool.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';

/**
 * The file-pipeline recovery sweeps — the 0.5 twins of 0.4's
 * `recoverStuckTranscriptions` and `recoverStuckRagIndexing`.
 *
 * Both exist for the same reason: every long pipeline here is driven by a
 * chain of jobs, and a chain that dies between links leaves a row claiming
 * to be in progress forever. Without them the symptom is the bug report the
 * 0.4 sweep was written for — "after an indexing error, nothing indexes any
 * more" — because the surface keeps waiting on a row nothing will touch.
 */

/** A transcription running longer than this is not going to finish. */
const TRANSCRIPTION_STALE_MS = 35 * 60 * 1000;
const TRANSCRIPTION_TIMEOUT_MESSAGE = 'Transcription timed out (watchdog)';

/**
 * Fail transcriptions whose runner died, and cascade to the video-link job
 * waiting on them.
 *
 * The cascade is load-bearing: the video-link watchdog deliberately SKIPS
 * `transcribing_handoff` (that state is delegated here), so without it the
 * job never reaches a terminal status, its cleanup never runs, and the audio
 * blob orphans.
 */
export async function recoverStuckTranscriptions(
  sql: Sql,
  options: { staleMs?: number } = {},
): Promise<{ failed: number; cascaded: number }> {
  const now = Date.now();
  const cutoff = now - (options.staleMs ?? TRANSCRIPTION_STALE_MS);
  const failed = await sql<{ storageRef: string | null }[]>`
    UPDATE app.file_metadata SET
      transcription_status = 'failed',
      transcription_error = ${TRANSCRIPTION_TIMEOUT_MESSAGE},
      transcription_run_id = NULL,
      transcription_lease_expires_at_ms = NULL,
      status_changed_at_ms = ${now}
    WHERE transcription_status = 'running'
      AND coalesce(transcription_started_at_ms, created_at_ms) < ${cutoff}
    RETURNING storage_ref AS "storageRef"
  `;
  if (failed.length === 0) return { failed: 0, cascaded: 0 };

  // Join on the raw blob REFERENCE so `s3:`-backed audio flips too (the 0.4
  // `by_storageId` reverse lookup).
  const refs = failed
    .map((row) => row.storageRef)
    .filter((ref): ref is string => ref !== null);
  if (refs.length === 0) return { failed: failed.length, cascaded: 0 };
  const cascaded = await sql<{ id: string }[]>`
    UPDATE app.video_link_jobs SET
      status = 'failed',
      status_changed_at_ms = ${now},
      error_reason_code = 'whisperFailed',
      error_message = 'Whisper transcription timed out (watchdog)'
    WHERE status = 'transcribing_handoff' AND storage_ref = ANY(${refs})
    RETURNING id
  `;
  console.info(
    `[watchdog] failed ${failed.length} stuck transcription(s); cascaded ${cascaded.length} video-link job(s)`,
  );
  return { failed: failed.length, cascaded: cascaded.length };
}

/** A RAG row untouched for this long has lost its chain. */
const RAG_STALE_AFTER_MS = 35 * 60 * 1000;
/** How far back a `failed` row is still reconciled (a false failure heals). */
const RAG_FAILED_RECONCILE_WINDOW_MS = 48 * 60 * 60 * 1000;
const RAG_MAX_PER_RUN = 200;
const RAG_INTERRUPTED_MESSAGE =
  'Indexing was interrupted and did not finish. Re-upload the file to try again.';

interface CorpusStatus {
  status: string;
  error: string | null;
  updatedAt: string | null;
}

/**
 * Corpus-side status for a batch of blob refs in ONE org — the 0.4
 * `knowledge/corpus_status.getStatuses` query against the same per-org pool.
 * A ref the corpus never saw answers `null`.
 */
async function readCorpusStatuses(
  orgSlug: string,
  fileIds: readonly string[],
): Promise<Map<string, CorpusStatus | null>> {
  const statuses = new Map<string, CorpusStatus | null>();
  for (const fileId of fileIds) statuses.set(fileId, null);
  if (fileIds.length === 0) return statuses;
  const pool = await getKnowledgePoolForOrg(orgSlug);
  const rows = await pool.unsafe<
    {
      file_id: string;
      status: string;
      error: string | null;
      updated_at: string | null;
    }[]
  >(
    `SELECT file_id, status, error, updated_at::text
       FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
      WHERE org_slug = $1 AND file_id = ANY($2)`,
    [orgSlug, [...fileIds]],
  );
  for (const row of rows) {
    statuses.set(row.file_id, {
      status: row.status,
      error: row.error,
      updatedAt: row.updated_at,
    });
  }
  return statuses;
}

/**
 * Reconcile stalled RAG rows against the corpus, then settle them. The order
 * of the rules is the whole point, and all of them are 0.4's:
 *
 *  - a row the corpus reports `completed` is ADOPTED, never failed — the
 *    indexing worked and only the status write was lost;
 *  - `processing` counts as alive while the corpus row is still moving
 *    (sliced indexing touches it per batch), dead once it stopped for the
 *    stale window;
 *  - a corpus lookup that THROWS leaves that org's rows for the next tick —
 *    a knowledge-db hiccup must not fail every file in the org;
 *  - a recent `failed` row is reconciled too, so a false failure heals;
 *  - an already-failed row is never overwritten with the generic interrupted
 *    text — its real error is the more useful one.
 */
export async function recoverStuckRagIndexing(
  sql: Sql,
  options: { staleMs?: number; limit?: number } = {},
): Promise<{ adopted: number; failed: number; revived: number }> {
  const staleMs = options.staleMs ?? RAG_STALE_AFTER_MS;
  const staleBefore = Date.now() - staleMs;
  const failedAfter = Date.now() - RAG_FAILED_RECONCILE_WINDOW_MS;
  const candidates = await sql<
    { id: string; orgId: string; storageRef: string; ragStatus: string }[]
  >`
    SELECT id, org_id AS "orgId", storage_ref AS "storageRef",
           rag_status AS "ragStatus"
    FROM app.file_metadata
    WHERE storage_ref IS NOT NULL
      AND (
        (rag_status IN ('queued', 'running')
          AND coalesce(rag_queued_at_ms, created_at_ms) < ${staleBefore})
        OR (rag_status = 'failed'
          AND coalesce(status_changed_at_ms, created_at_ms) > ${failedAfter})
      )
    ORDER BY coalesce(rag_queued_at_ms, created_at_ms)
    LIMIT ${options.limit ?? RAG_MAX_PER_RUN}
  `;
  if (candidates.length === 0) return { adopted: 0, failed: 0, revived: 0 };

  type RagCandidate = (typeof candidates)[number];
  const byOrg = new Map<string, RagCandidate[]>();
  for (const row of candidates) {
    const bucket = byOrg.get(row.orgId);
    if (bucket) bucket.push(row);
    else byOrg.set(row.orgId, [row]);
  }

  const now = Date.now();
  let adopted = 0;
  let failed = 0;
  let revived = 0;
  for (const [orgId, rows] of byOrg) {
    const slugRows = await sql<{ slug: string }[]>`
      SELECT "slug" FROM "organization" WHERE "id" = ${orgId} LIMIT 1
    `;
    const orgSlug = slugRows[0]?.slug;
    if (orgSlug === undefined) continue;

    let statuses: Map<string, CorpusStatus | null>;
    try {
      statuses = await readCorpusStatuses(
        orgSlug,
        rows.map((row) => row.storageRef),
      );
    } catch (error) {
      // A knowledge-db fault must not fail this org's files — defer them.
      console.warn(
        `[watchdog] corpus status lookup failed for org ${orgSlug}; deferring ${rows.length} row(s):`,
        error instanceof Error ? error.message : String(error),
      );
      continue;
    }

    for (const row of rows) {
      const status = statuses.get(row.storageRef) ?? null;
      if (status?.status === 'completed') {
        await sql`
          UPDATE app.file_metadata SET
            rag_status = 'completed', rag_error = NULL, rag_error_code = NULL,
            rag_indexed_at_ms = ${now}, status_changed_at_ms = ${now}
          WHERE id = ${row.id}
        `;
        // The document list renders this column; without a hint the browser
        // keeps showing whatever state the page was loaded with.
        await emitHintInTx(sql, {
          orgId,
          entity: 'document',
          entityId: null,
        });
        adopted += 1;
        continue;
      }
      if (status?.status === 'failed') {
        // The corpus knows the REAL error; refresh the row with it.
        await sql`
          UPDATE app.file_metadata SET
            rag_status = 'failed',
            rag_error = ${status.error ?? RAG_INTERRUPTED_MESSAGE},
            status_changed_at_ms = ${now}
          WHERE id = ${row.id}
        `;
        await emitHintInTx(sql, {
          orgId,
          entity: 'document',
          entityId: null,
        });
        if (row.ragStatus !== 'failed') failed += 1;
        continue;
      }
      if (status?.status === 'processing') {
        const updatedAt =
          status.updatedAt === null ? Number.NaN : Date.parse(status.updatedAt);
        const fresh =
          Number.isFinite(updatedAt) && Date.now() - updatedAt < staleMs;
        if (fresh) {
          // A live chain under a `failed` row is a false failure — flip it
          // back so the person watches real progress, not a wrong error.
          if (row.ragStatus === 'failed') {
            await sql`
              UPDATE app.file_metadata SET
                rag_status = 'running', rag_error = NULL,
                rag_error_code = NULL, status_changed_at_ms = ${now}
              WHERE id = ${row.id}
            `;
            revived += 1;
          }
          continue;
        }
      }
      // Stale `processing` or never ingested: the job will not finish. An
      // already-failed row keeps its own (possibly real) error.
      if (row.ragStatus === 'failed') continue;
      await sql`
        UPDATE app.file_metadata SET
          rag_status = 'failed', rag_error = ${RAG_INTERRUPTED_MESSAGE},
          status_changed_at_ms = ${now}
        WHERE id = ${row.id}
      `;
      failed += 1;
    }
  }
  if (adopted + failed + revived > 0) {
    console.info(
      `[watchdog] rag reconcile: adopted ${adopted}, failed ${failed}, revived ${revived}`,
    );
  }
  return { adopted, failed, revived };
}
