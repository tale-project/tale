import type { Sql } from 'postgres';

import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
} from '../../core/knowledge/pool.ts';
import {
  HELD_BY_DOCUMENT_SQL,
  hintDocumentLists,
  type MovedStatusRow,
} from '../knowledge/status-hints.ts';
import { hintVideoJobs, type VideoJobHintRow } from '../video_links/hints.ts';

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
const TRANSCRIPTION_NEVER_STARTED_MESSAGE =
  'Transcription never started (watchdog)';

/**
 * Fail transcriptions whose chain died, and cascade to the video-link job
 * waiting on them. Two shapes of dead chain exist:
 *
 *  - a dead RUN: the lease claim stamped `running` + `started_at` (see
 *    `acquireTranscriptionLease`) and the runner then crashed — the row is
 *    `running` past the stale window;
 *  - a dead QUEUE: the crash hit between pickup and claim, or the enqueue
 *    itself was lost (`files.transcribe` has retryLimit 0) — the row is
 *    `queued`, stale, and no live lease protects it. The engine's own
 *    delayed self-retries re-claim within minutes, so a stale, lease-free
 *    `queued` row is a chain nothing will resume. Failing it is safe even
 *    against a merely-backlogged job: the engine's pre-check treats a
 *    `failed` row as cancelled and does no work.
 *
 * Both fail with a watchdog-attributed, RETRYABLE error — the user sees a
 * failed chip with a working Retry, not a forever-spinner.
 *
 * The cascade is load-bearing: the video-link watchdog deliberately leaves
 * a LIVE `transcribing_handoff` alone (that state is delegated here), so
 * without it the job never reaches a terminal status, its cleanup never
 * runs, and the audio blob orphans.
 */
export async function recoverStuckTranscriptions(
  sql: Sql,
  options: { staleMs?: number } = {},
): Promise<{ failed: number; cascaded: number }> {
  const now = Date.now();
  const cutoff = now - (options.staleMs ?? TRANSCRIPTION_STALE_MS);
  const deadRuns = await sql<{ storageRef: string | null }[]>`
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
  const deadQueued = await sql<{ storageRef: string | null }[]>`
    UPDATE app.file_metadata SET
      transcription_status = 'failed',
      transcription_error = ${TRANSCRIPTION_NEVER_STARTED_MESSAGE},
      transcription_run_id = NULL,
      transcription_lease_expires_at_ms = NULL,
      status_changed_at_ms = ${now}
    WHERE transcription_status = 'queued'
      AND coalesce(status_changed_at_ms, created_at_ms) < ${cutoff}
      AND (transcription_run_id IS NULL
           OR transcription_lease_expires_at_ms IS NULL
           OR transcription_lease_expires_at_ms < ${now})
    RETURNING storage_ref AS "storageRef"
  `;
  const failed = [...deadRuns, ...deadQueued];
  if (failed.length === 0) return { failed: 0, cascaded: 0 };

  // Join on the raw blob REFERENCE so `s3:`-backed audio flips too (the 0.4
  // `by_storageId` reverse lookup).
  const refs = failed
    .map((row) => row.storageRef)
    .filter((ref): ref is string => ref !== null);
  if (refs.length === 0) return { failed: failed.length, cascaded: 0 };
  const cascaded = await sql<VideoJobHintRow[]>`
    UPDATE app.video_link_jobs SET
      status = 'failed',
      status_changed_at_ms = ${now},
      error_reason_code = 'whisperFailed',
      error_message = 'Whisper transcription timed out (watchdog)'
    WHERE status = 'transcribing_handoff' AND storage_ref = ANY(${refs})
    RETURNING id, org_id AS "organizationId", uploaded_by AS "uploadedBy"
  `;
  await hintVideoJobs(sql, cascaded);
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
/**
 * How many status writes must fail in a row to stop an organization's sweep.
 * One failing write is its row's own (a lock held across ticks); a second
 * straight after it points at the connection, which is not sent the rest of
 * the batch.
 */
const RAG_SETTLE_FAULTS_IN_A_ROW = 2;
/**
 * The `rag_error` a dead chain is settled with. It names the recovery the
 * failed badge already offers: the blob is still stored (every candidate has
 * a `storage_ref`) and Retry indexing re-runs the pipeline on it — the ingest
 * upserts the corpus row `ON CONFLICT (org_slug, file_id)`, so a half-written
 * document is reset and re-chunked. Telling the person to re-upload, as this
 * text once did, made them recreate a document the retry button recovers.
 */
export const RAG_INTERRUPTED_MESSAGE =
  'Indexing was interrupted before it finished. The stored file is intact — use Retry indexing to index it again.';

interface CorpusStatus {
  status: string;
  error: string | null;
  updatedAt: string | null;
}

/** A stalled RAG row the sweep reconciles. */
interface RagCandidate {
  id: string;
  orgId: string;
  storageRef: string;
  ragStatus: string;
  ragError: string | null;
}

/** What a sweep did, summed across its organizations. */
interface RagReconcileCounts {
  adopted: number;
  failed: number;
  revived: number;
}

/** What settling one candidate wrote: the rows it moved, and the count they
 * add to (none for an already-failed row given its real error). */
interface RagSettle {
  moved: { id: string }[];
  counts: keyof RagReconcileCounts | null;
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
 *  - a status write that throws leaves only its own row for the next tick,
 *    and the org's rows after it are still settled: the candidates come in
 *    a fixed order, so a row whose write keeps failing (a lock held across
 *    ticks) would otherwise hold back every row queued after it, tick after
 *    tick. Two writes failing in a row stop that org's sweep, since the
 *    connection is the likelier cause; the rows it already settled still
 *    reach the lists;
 *  - any other fault in one org (its slug read) defers that org alone, and
 *    the orgs after it are still swept;
 *  - a recent `failed` row is reconciled too, so a false failure heals —
 *    but only after every stuck row: one limit covers both kinds, and a
 *    stuck row is what the sweep exists for;
 *  - an already-failed row is never overwritten with the generic interrupted
 *    text — its real error is the more useful one — and one that already
 *    reads the corpus's error is left exactly as it is.
 *
 * Every write here moves a status the document list renders, so each
 * organization's lists hear the sweep once — and only for rows a document
 * holds: a stuck chat, task or email attachment is on no list
 * (`status-hints.ts`).
 */
export async function recoverStuckRagIndexing(
  sql: Sql,
  options: { staleMs?: number; limit?: number } = {},
): Promise<RagReconcileCounts> {
  const staleMs = options.staleMs ?? RAG_STALE_AFTER_MS;
  const staleBefore = Date.now() - staleMs;
  const failedAfter = Date.now() - RAG_FAILED_RECONCILE_WINDOW_MS;
  // The stuck rows first, then the failed ones, each oldest first, as 0.4
  // read them. Ranked by queue time alone, the failed rows of the last two
  // days sorted ahead of every row that got stuck after them, and two
  // hundred of them filled the batch: those rows were never reached.
  const candidates = await sql<RagCandidate[]>`
    SELECT id, org_id AS "orgId", storage_ref AS "storageRef",
           rag_status AS "ragStatus", rag_error AS "ragError"
    FROM app.file_metadata
    WHERE storage_ref IS NOT NULL
      AND (
        (rag_status IN ('queued', 'running')
          AND coalesce(rag_queued_at_ms, created_at_ms) < ${staleBefore})
        OR (rag_status = 'failed'
          AND coalesce(status_changed_at_ms, created_at_ms) > ${failedAfter})
      )
    ORDER BY (rag_status = 'failed'), coalesce(rag_queued_at_ms, created_at_ms)
    LIMIT ${options.limit ?? RAG_MAX_PER_RUN}
  `;
  if (candidates.length === 0) return { adopted: 0, failed: 0, revived: 0 };

  const byOrg = new Map<string, RagCandidate[]>();
  for (const row of candidates) {
    const bucket = byOrg.get(row.orgId);
    if (bucket) bucket.push(row);
    else byOrg.set(row.orgId, [row]);
  }

  const timing = { now: Date.now(), staleMs };
  const counts: RagReconcileCounts = { adopted: 0, failed: 0, revived: 0 };
  for (const [orgId, rows] of byOrg) {
    try {
      await settleOrganizationRagRows(sql, orgId, rows, timing, counts);
    } catch (error) {
      // What an organization's sweep does not catch itself — its slug read
      // on a dropped connection or a statement timeout — defers that
      // organization alone. The cron handler does not catch either: a throw
      // escaping here ended the tick, and every organization after this one
      // went unswept.
      console.warn(
        `[watchdog] rag sweep failed for org ${orgId}; deferring its ${rows.length} row(s):`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  const { adopted, failed, revived } = counts;
  if (adopted + failed + revived > 0) {
    console.info(
      `[watchdog] rag reconcile: adopted ${adopted}, failed ${failed}, revived ${revived}`,
    );
  }
  return counts;
}

/**
 * One organization's candidates, settled by the rules above and told to its
 * document lists. Each settle is counted into `counts` as it lands, so a
 * fault later in the organization never drops it from the sweep's total.
 */
async function settleOrganizationRagRows(
  sql: Sql,
  orgId: string,
  rows: readonly RagCandidate[],
  timing: { now: number; staleMs: number },
  counts: RagReconcileCounts,
): Promise<void> {
  const slugRows = await sql<{ slug: string }[]>`
    SELECT "slug" FROM "organization" WHERE "id" = ${orgId} LIMIT 1
  `;
  const orgSlug = slugRows[0]?.slug;
  if (orgSlug === undefined) return;

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
    return;
  }

  // The rows this sweep moved: the document list renders the column, and
  // without a hint the browser keeps showing whatever state the page was
  // loaded with.
  const moved: { id: string }[] = [];
  let faultsInARow = 0;
  for (const [index, row] of rows.entries()) {
    let settled: RagSettle | null;
    try {
      settled = await settleRagRow(
        sql,
        row,
        statuses.get(row.storageRef) ?? null,
        timing,
      );
    } catch (error) {
      // A write that throws — a lock or statement timeout, a dropped
      // connection — defers its own row to the next tick, and the rows
      // after it are still tried. Each write is its own statement, so the
      // rows already settled stay settled and are still told below.
      console.warn(
        `[watchdog] rag settle failed for file ${row.id} in org ${orgSlug}; deferring it:`,
        error instanceof Error ? error.message : String(error),
      );
      faultsInARow += 1;
      if (faultsInARow < RAG_SETTLE_FAULTS_IN_A_ROW) continue;
      console.warn(
        `[watchdog] ${faultsInARow} rag settles in a row failed for org ${orgSlug}; deferring its ${rows.length - index - 1} remaining row(s)`,
      );
      break;
    }
    // A row the rules leave as it is wrote nothing, so it says nothing about
    // the connection: only a write that went through ends a run of faults.
    if (settled === null) continue;
    faultsInARow = 0;
    moved.push(...settled.moved);
    if (settled.counts !== null) counts[settled.counts] += settled.moved.length;
  }
  if (moved.length === 0) return;
  try {
    // A document can bind a file while the corpus is read, or hold its
    // metadata lock while a settle waits. Read ownership AFTER the writes
    // in a fresh statement: an UPDATE RETURNING probe could still use the
    // snapshot from before that bind committed. A later bind emits its
    // own document hint after these settled statuses are visible.
    const current = await sql<MovedStatusRow[]>`
      SELECT fm.org_id AS "orgId",
             ${sql.unsafe(HELD_BY_DOCUMENT_SQL)} AS "listed"
      FROM app.file_metadata fm
      WHERE fm.org_id = ${orgId} AND fm.id = ANY(${moved.map((row) => row.id)})
    `;
    await hintDocumentLists(sql, current);
  } catch (error) {
    // The statuses are written; only the refetch nudge is lost. The
    // organizations after this one are still swept.
    console.warn(
      `[watchdog] could not tell org ${orgSlug}'s document lists about ${moved.length} settled row(s):`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * One candidate against its corpus row: at most one status write, whose
 * fault is thrown to the caller. Null when the rules leave the row as it is
 * and nothing was written.
 */
async function settleRagRow(
  sql: Sql,
  row: RagCandidate,
  status: CorpusStatus | null,
  timing: { now: number; staleMs: number },
): Promise<RagSettle | null> {
  const { now, staleMs } = timing;
  if (status?.status === 'completed') {
    const moved = await sql<{ id: string }[]>`
      UPDATE app.file_metadata SET
        rag_status = 'completed', rag_error = NULL, rag_error_code = NULL,
        rag_indexed_at_ms = ${now}, status_changed_at_ms = ${now}
      WHERE id = ${row.id}
      RETURNING id
    `;
    return { moved, counts: 'adopted' };
  }
  if (status?.status === 'failed') {
    if (row.ragStatus !== 'failed') {
      // The corpus knows the REAL error; the generic text stands in only
      // for none.
      const moved = await sql<{ id: string }[]>`
        UPDATE app.file_metadata SET
          rag_status = 'failed',
          rag_error = ${status.error ?? RAG_INTERRUPTED_MESSAGE},
          status_changed_at_ms = ${now}
        WHERE id = ${row.id}
        RETURNING id
      `;
      return { moved, counts: 'failed' };
    }
    // Already failed: the corpus's error replaces the row's. Without one the
    // row keeps its own — a secret scan's refusal records none on the corpus
    // — and only a row with none either takes the generic text.
    const error = status.error ?? row.ragError ?? RAG_INTERRUPTED_MESSAGE;
    // Settled once the row reads that error, and left as it is. Writing it
    // again moved `status_changed_at_ms`, the clock of the failed window, so
    // the row never left the window: it was rewritten, and its lists told, on
    // every tick. Another text is corrected in place — the status has not
    // changed, so neither does its clock.
    if (row.ragError === error) return null;
    const moved = await sql<{ id: string }[]>`
      UPDATE app.file_metadata SET rag_error = ${error}
      WHERE id = ${row.id} AND rag_status = 'failed'
      RETURNING id
    `;
    return { moved, counts: null };
  }
  if (status?.status === 'processing') {
    const updatedAt =
      status.updatedAt === null ? Number.NaN : Date.parse(status.updatedAt);
    const fresh =
      Number.isFinite(updatedAt) && Date.now() - updatedAt < staleMs;
    if (fresh) {
      // A live chain under a `failed` row is a false failure — flip it
      // back so the person watches real progress, not a wrong error.
      if (row.ragStatus !== 'failed') return null;
      const moved = await sql<{ id: string }[]>`
        UPDATE app.file_metadata SET
          rag_status = 'running', rag_error = NULL,
          rag_error_code = NULL, status_changed_at_ms = ${now}
        WHERE id = ${row.id}
        RETURNING id
      `;
      return { moved, counts: 'revived' };
    }
  }
  // Stale `processing` or never ingested: the job will not finish. An
  // already-failed row keeps its own (possibly real) error.
  if (row.ragStatus === 'failed') return null;
  const moved = await sql<{ id: string }[]>`
    UPDATE app.file_metadata SET
      rag_status = 'failed', rag_error = ${RAG_INTERRUPTED_MESSAGE},
      status_changed_at_ms = ${now}
    WHERE id = ${row.id}
    RETURNING id
  `;
  return { moved, counts: 'failed' };
}
