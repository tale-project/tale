import type { Sql, TransactionSql } from 'postgres';

import {
  TEXT_READ_FAILED,
  TEXT_TOO_LARGE,
  TEXT_TOO_MUCH,
  type DocumentTextStatus,
} from '../../../lib/shared/document-reading.ts';
import {
  isAudioOrVideo,
  isImage,
  READ_WITHOUT_INDEX_MAX_TEXT,
  readWithoutIndexCap,
} from '../../../lib/shared/file-types.ts';
import { gateDocumentText } from '../../core/knowledge/indexing.ts';
import { dropKeptText, keepReadText } from '../../core/knowledge/kept_reads.ts';
import { parsePiiConfig } from '../../core/knowledge/pii_gate.ts';
import {
  RAG_ERROR_EMPTY,
  RAG_ERROR_MALFORMED,
  RAG_ERROR_NOT_TEXT,
  RAG_ERROR_PII_BLOCKED,
  RAG_ERROR_PII_SCAN_FAILED,
  RAG_ERROR_SECRET_DETECTED,
} from '../../core/knowledge/rag_error_codes.ts';
import { unsupportedByName } from '../../core/knowledge/rag_unsupported.ts';
import { ExtractionError } from '../../core/lib/knowledge/extraction/errors.ts';
import {
  extractDocument,
  isSupported,
} from '../../core/lib/knowledge/extraction/router.ts';
import {
  parseBlobRef,
  s3KeyBelongsToOrg,
} from '../../core/lib/storage/blob_ref.ts';
import { s3GetObjectBytesIfExists } from '../../core/lib/storage/object_store.ts';
import {
  addJobInTx,
  PRIORITY_ATTACHMENT,
  PRIORITY_INTERACTIVE,
} from '../../jobs/enqueue.ts';
import { locateOrgObjectStore } from '../../lib/object-store.ts';
import { readGovernancePolicy, resolveOrgSlug } from '../../lib/org-config.ts';
import { stampExtractionMetadata } from './extraction-metadata.ts';

/**
 * A document's text read for the assistant ahead of its index — on a worker,
 * never in the api process that runs the app's chat turns.
 *
 * A message that carried a document used to wait until the document was
 * indexed: extracted, then embedded chunk by chunk, so the organization's
 * embedding server — and every upload queued before the attachment —
 * decided whether a chat could be sent at all. Now an upload's door queues a
 * read ({@link queueDocumentRead}): the indexer's own extractor, then the
 * organization's secret scan and PII policy on the bytes, the text and the
 * file's name, exactly as indexing applies them (`gateDocumentText`). The
 * checked text is kept in the organization's knowledge database, where the
 * index's text lives (`core/knowledge/kept_reads.ts`), until the file's index
 * is complete; the file's row records only where the read stands
 * (`text_status`). A message waits for the read, which takes seconds, and
 * the assistant reads the text through `rag_fetch` while the index is built.
 *
 * The read hands the file's first index run on when it is decided, in the
 * same transaction, so the two never extract one file at once and the index
 * starts from the checked text instead of the bytes. A document too large to
 * read this way is left to its index (`deferred`), and a message carrying it
 * waits for the index, as every message used to.
 */

/** A read whose verdict a transient fault may have caused — the platform's
 * own failure, or a PII scan that could not run — is read again when the
 * assistant reaches for the file, once it is this old. */
const READ_RETRY_AFTER_MS = 60_000;

/** A pending read whose job pg-boss no longer holds has lost it, once it is
 * this old (its job was inserted with the status, so it is never missed in
 * between). */
const READ_LOST_AFTER_MS = 60_000;

/** A read still pending this long after it was queued is settled however
 * its job stands: a message waiting on it has waited longer than an index
 * run takes, and the index decides from here. */
const READ_STALE_AFTER_MS = 15 * 60_000;

const READ_WATCHDOG_MAX_PER_RUN = 200;

/** What one read decided. */
type ReadVerdict =
  | { readonly status: 'ready'; readonly text: string }
  | {
      readonly status: Exclude<
        DocumentTextStatus,
        'queued' | 'running' | 'ready'
      >;
      readonly code: string;
    };

const REFUSAL_CODES = {
  'secret-detected': RAG_ERROR_SECRET_DETECTED,
  'pii-blocked': RAG_ERROR_PII_BLOCKED,
  'pii-scan-failed': RAG_ERROR_PII_SCAN_FAILED,
} as const;

/**
 * Queue an upload's read, inside the transaction that registers it. The
 * read queues the file's index run once it is decided (`thenIndex`), so the
 * caller queues no index run of its own — it marks the index queued, so the
 * file's state reads the same as every other upload's.
 */
export async function queueDocumentRead(
  tx: TransactionSql | Sql,
  file: { readonly fileId: string; readonly organizationId: string },
): Promise<void> {
  await tx`
    UPDATE app.file_metadata SET
      text_status = 'queued', text_error_code = NULL,
      text_read_at_ms = ${Date.now()}
    WHERE id = ${file.fileId}
  `;
  await addJobInTx(
    tx,
    'rag.read_file',
    {
      fileId: file.fileId,
      organizationId: file.organizationId,
      thenIndex: true,
    },
    { priority: PRIORITY_ATTACHMENT },
  );
}

/**
 * Ask for the read of a file the on-demand lane has no text for — the
 * assistant reaching for a document its index will never serve (a
 * REST-bound project file skips indexing by default), a file stored before
 * reads existed, or a file whose kept text is gone. Queues no index run.
 * The claim is the UPDATE, so two readers asking at once queue one read.
 * True when a read is pending for the file after the call.
 *
 * A verdict a transient fault may have caused — the read failed on the
 * platform's side, or the PII scan could not run — is read again once it is
 * {@link READ_RETRY_AFTER_MS} old, unless the file's index is on its way and
 * will decide. Every other verdict stands until the file changes.
 */
export async function requestDocumentRead(
  sql: Sql,
  args: { readonly organizationId: string; readonly storageRef: string },
): Promise<boolean> {
  return await sql.begin(async (tx) => {
    const rows = await tx<
      {
        id: string;
        fileName: string;
        contentType: string;
        textStatus: string | null;
        textErrorCode: string | null;
        textReadAtMs: number | null;
        ragStatus: string | null;
      }[]
    >`
      SELECT id, file_name AS "fileName", content_type AS "contentType",
             text_status AS "textStatus", text_error_code AS "textErrorCode",
             text_read_at_ms::float8 AS "textReadAtMs",
             CASE WHEN skip_rag_indexing IS TRUE THEN NULL
                  ELSE rag_status END AS "ragStatus"
      FROM app.file_metadata
      WHERE org_id = ${args.organizationId}
        AND storage_ref = ${args.storageRef}
        AND (lifecycle_status IS NULL OR lifecycle_status <> 'trashed')
      ORDER BY created_at_ms ASC
      LIMIT 1
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return false;
    if (row.textStatus === 'queued' || row.textStatus === 'running') {
      return true;
    }
    // Only a document an extractor reads.
    if (
      !isSupported(row.fileName) ||
      isImage(row.contentType) ||
      isAudioOrVideo(row.contentType) ||
      !readAgain(row)
    ) {
      return false;
    }
    await tx`
      UPDATE app.file_metadata SET
        text_status = 'queued', text_error_code = NULL,
        text_read_at_ms = ${Date.now()}
      WHERE id = ${row.id}
    `;
    // Below an upload's read: a person waiting on an attachment goes first,
    // ahead of an automation that fetches its way through a project.
    await addJobInTx(
      tx,
      'rag.read_file',
      {
        fileId: row.id,
        organizationId: args.organizationId,
        thenIndex: false,
      },
      { priority: PRIORITY_INTERACTIVE },
    );
    return true;
  });
}

/** Whether a file the on-demand lane has no text for is read (again): one
 * never read, one whose kept text is gone (its index completed, and the
 * corpus has since lost it), and one whose verdict may have been a passing
 * fault, once it is old enough and no index run will decide instead. */
function readAgain(row: {
  readonly textStatus: string | null;
  readonly textErrorCode: string | null;
  readonly textReadAtMs: number | null;
  readonly ragStatus: string | null;
}): boolean {
  if (row.textStatus === null || row.textStatus === 'ready') return true;
  const transient =
    (row.textStatus === 'deferred' && row.textErrorCode === TEXT_READ_FAILED) ||
    (row.textStatus === 'refused' &&
      row.textErrorCode === RAG_ERROR_PII_SCAN_FAILED);
  if (!transient) return false;
  if (row.ragStatus === 'queued' || row.ragStatus === 'running') return false;
  return (row.textReadAtMs ?? 0) < Date.now() - READ_RETRY_AFTER_MS;
}

/**
 * The `rag.read_file` job: read one file, keep its checked text or why
 * there is none, and hand its index run on.
 *
 * A failure the read can name is its verdict. Any other — the store, a
 * parser that throws something of its own, a policy that cannot be read, the
 * knowledge database refusing the text — leaves the file to its index
 * (`deferred`, `read_failed`), which has its own retries and its own words
 * for the person; the read is never retried for it, so a message waits at
 * most as long as it always did. Only a run lost with its worker, or stopped
 * at its budget, is retried by pg-boss, and a read whose job is gone for good
 * is settled by {@link recoverStuckReads}.
 */
export async function readUploadedFileText(
  sql: Sql,
  job: {
    readonly fileId: string;
    readonly organizationId: string;
    readonly thenIndex: boolean;
  },
  options: { readonly signal?: AbortSignal } = {},
): Promise<void> {
  // The claim: a read already decided (a redelivered job, or a read the
  // upload's door queued again) is left as it is.
  const claimed = await sql<
    {
      storageRef: string;
      fileName: string;
      contentType: string;
      size: number;
    }[]
  >`
    UPDATE app.file_metadata SET text_status = 'running'
    WHERE id = ${job.fileId} AND org_id = ${job.organizationId}
      AND text_status IN ('queued', 'running')
    RETURNING storage_ref AS "storageRef", file_name AS "fileName",
              content_type AS "contentType", size::float8 AS size
  `;
  const file = claimed[0];
  if (!file) return;

  let verdict: ReadVerdict;
  let orgSlug: string | null = null;
  try {
    orgSlug = await resolveOrgSlug(sql, job.organizationId);
    if (orgSlug === null) throw new Error('The organization has no slug');
    verdict = await readAndCheck(sql, job, file, orgSlug);
    // Kept before the verdict says so: a reader that sees the read ready
    // finds its text.
    if (verdict.status === 'ready') {
      await keepReadText(orgSlug, file.storageRef, verdict.text);
    }
  } catch (error) {
    if (options.signal?.aborted) {
      // pg-boss stopped the run at its budget, or its worker is going
      // down: the retry reads the file again from the start.
      throw new Error(
        'Reading a document stopped because its job was cancelled; the retry reads it again.',
        { cause: error },
      );
    }
    console.warn(
      '[knowledge] reading a document failed; its index decides instead',
      {
        fileId: job.fileId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
    verdict = { status: 'deferred', code: TEXT_READ_FAILED };
  }
  const kept = await settleRead(sql, job, verdict);
  if (verdict.status === 'ready' && !kept && orgSlug !== null) {
    await dropUnservedText(orgSlug, job.fileId, file.storageRef);
  }
}

async function readAndCheck(
  sql: Sql,
  job: { readonly fileId: string; readonly organizationId: string },
  file: {
    readonly storageRef: string;
    readonly fileName: string;
    readonly contentType: string;
    readonly size: number;
  },
  orgSlug: string,
): Promise<ReadVerdict> {
  // The indexer's by-name rule: no extractor for the type, or a picture.
  const byName = unsupportedByName(file.fileName);
  if (byName !== null) return { status: 'unreadable', code: byName.code };
  // The register step HEADs the landed object, so `size` is the store's
  // own figure — checked before a byte is fetched, and again on what came.
  const cap = readWithoutIndexCap(file.fileName);
  if (file.size > cap) return { status: 'deferred', code: TEXT_TOO_LARGE };

  const parsed = parseBlobRef(file.storageRef);
  if (parsed.backend !== 's3' || !s3KeyBelongsToOrg(parsed.key, orgSlug)) {
    throw new Error('The file is not stored under its organization');
  }
  const store = await locateOrgObjectStore(orgSlug, parsed.key);
  const bytes = await s3GetObjectBytesIfExists(store, parsed.key);
  if (bytes === null || bytes.byteLength === 0) {
    return { status: 'unreadable', code: RAG_ERROR_EMPTY };
  }
  if (bytes.byteLength > cap) {
    return { status: 'deferred', code: TEXT_TOO_LARGE };
  }

  // The indexer's own call, so the text is the very text its index run
  // would extract — and that run starts from it.
  let text: string;
  try {
    const extracted = await extractDocument(bytes, file.fileName);
    await stampExtractionMetadata(sql, job.fileId, extracted);
    text = extracted.text;
  } catch (error) {
    if (error instanceof ExtractionError) {
      return {
        status: 'unreadable',
        code:
          error.code === 'not_text' ? RAG_ERROR_NOT_TEXT : RAG_ERROR_MALFORMED,
      };
    }
    throw error;
  }
  if (text.length > READ_WITHOUT_INDEX_MAX_TEXT) {
    return { status: 'deferred', code: TEXT_TOO_MUCH };
  }

  // Strict: a policy that cannot be read must not read as no policy.
  const piiConfig = parsePiiConfig(
    await readGovernancePolicy(orgSlug, 'pii_config', { strict: true }),
  );
  const gated = gateDocumentText({
    text,
    bytes,
    piiConfig,
    filename: file.fileName,
  });
  if (gated.kind === 'refused') {
    return { status: 'refused', code: REFUSAL_CODES[gated.skipped] };
  }
  if (gated.kind === 'empty') {
    return { status: 'unreadable', code: RAG_ERROR_EMPTY };
  }
  return { status: 'ready', text: gated.text };
}

/**
 * Write the verdict and, for an upload, queue the file's index run — one
 * transaction, so a crash between them cannot leave the index queued with no
 * job to run it. Only a read still running is settled: a file deleted or
 * read again meanwhile keeps what it has. A document left to its index has
 * a message waiting for that run, so the run goes ahead of other uploads.
 *
 * True when a reader will be sent to the text a ready read kept: the read
 * settled, and — for an upload's read — the file's index has not completed
 * meanwhile; once it has, the corpus serves the text, and the kept copy is
 * dropped. A read the on-demand lane asked for keeps its text however the
 * index stands: it was asked for because the corpus does not serve it.
 */
async function settleRead(
  sql: Sql,
  job: { readonly fileId: string; readonly thenIndex: boolean },
  verdict: ReadVerdict,
): Promise<boolean> {
  return await sql.begin(async (tx) => {
    const rows = await tx<{ ragStatus: string | null }[]>`
      UPDATE app.file_metadata SET
        text_status = ${verdict.status},
        text_error_code = ${verdict.status === 'ready' ? null : verdict.code}
      WHERE id = ${job.fileId} AND text_status = 'running'
      RETURNING CASE WHEN skip_rag_indexing IS TRUE THEN NULL
                     ELSE rag_status END AS "ragStatus"
    `;
    const row = rows[0];
    if (!row) {
      // Settled meanwhile — by the watchdog, or by a newer read of the same
      // bytes, whose text this one may have replaced with its equal.
      const current = await tx<
        { textStatus: string | null; ragStatus: string | null }[]
      >`
        SELECT text_status AS "textStatus", rag_status AS "ragStatus"
        FROM app.file_metadata WHERE id = ${job.fileId}
      `;
      const now = current[0];
      return (
        now?.textStatus === 'ready' &&
        !(job.thenIndex && now.ragStatus === 'completed')
      );
    }
    if (job.thenIndex && row.ragStatus === 'queued') {
      await handIndexOn(tx, job.fileId, {
        waitedFor: verdict.status === 'deferred',
      });
    }
    return !(job.thenIndex && row.ragStatus === 'completed');
  });
}

/** Queue the index run a read hands on, stamped as queued now: the RAG
 * watchdog times a queued index from its stamp, and the upload's stamp is
 * as old as the read. A run a message waits for — the read left the file to
 * its index — goes ahead of other uploads. */
async function handIndexOn(
  tx: TransactionSql,
  fileId: string,
  options: { readonly waitedFor: boolean },
): Promise<void> {
  await tx`
    UPDATE app.file_metadata SET rag_queued_at_ms = ${Date.now()}
    WHERE id = ${fileId} AND rag_status = 'queued'
  `;
  await addJobInTx(
    tx,
    'rag.index_file',
    { fileId },
    {
      priority: options.waitedFor ? PRIORITY_ATTACHMENT : PRIORITY_INTERACTIVE,
    },
  );
}

/** Drop text a read kept that no reader will be sent to. Best-effort: what
 * stays behind is in the organization's knowledge database, and goes with
 * the file. */
async function dropUnservedText(
  orgSlug: string,
  fileId: string,
  storageRef: string,
): Promise<void> {
  try {
    await dropKeptText(orgSlug, [storageRef]);
  } catch (error) {
    console.warn(
      '[knowledge] dropping the text of a read no reader is sent to failed; it goes with the file',
      {
        fileId,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

/**
 * The read watchdog: settle every read that will not settle itself, so a
 * message never waits on a read nothing runs. A pending read is lost once
 * pg-boss holds no job for it — its worker was killed on every attempt, or
 * a release without the read's handler took the job — and is given up
 * {@link READ_STALE_AFTER_MS} after it was queued however its job stands.
 * Either way the read defers to the file's index (`read_failed`), as a read
 * that failed on its own does, and hands the index run on when an upload's
 * read was to queue it: the file's index is queued and no index job waits
 * for it. A read that settles after all finds the row decided and leaves it.
 *
 * Runs on the RAG watchdog's tick, before it: the RAG sweep leaves a row
 * whose read is pending alone, and times the index from the handoff.
 */
export async function recoverStuckReads(
  sql: Sql,
  options: { readonly limit?: number } = {},
): Promise<number> {
  const now = Date.now();
  const candidates = await sql<{ id: string }[]>`
    SELECT fm.id FROM app.file_metadata fm
    WHERE fm.text_status IN ('queued', 'running')
      AND (
        coalesce(fm.text_read_at_ms, fm.created_at_ms)
          < ${now - READ_STALE_AFTER_MS}
        OR (coalesce(fm.text_read_at_ms, fm.created_at_ms)
              < ${now - READ_LOST_AFTER_MS}
            AND NOT EXISTS (
              SELECT 1 FROM pgboss.job j
              WHERE j.name = 'rag.read_file'
                AND j.data ->> 'fileId' = fm.id
                AND j.state IN ('created', 'retry', 'active')
            ))
      )
    ORDER BY coalesce(fm.text_read_at_ms, fm.created_at_ms)
    LIMIT ${options.limit ?? READ_WATCHDOG_MAX_PER_RUN}
  `;
  let settled = 0;
  for (const candidate of candidates) {
    try {
      const moved = await sql.begin(async (tx) => {
        const rows = await tx<{ ragStatus: string | null }[]>`
          UPDATE app.file_metadata SET
            text_status = 'deferred', text_error_code = ${TEXT_READ_FAILED}
          WHERE id = ${candidate.id}
            AND text_status IN ('queued', 'running')
          RETURNING CASE WHEN skip_rag_indexing IS TRUE THEN NULL
                         ELSE rag_status END AS "ragStatus"
        `;
        if (rows.length === 0) return false;
        if (
          rows[0]?.ragStatus === 'queued' &&
          !(await indexJobWaiting(tx, candidate.id))
        ) {
          await handIndexOn(tx, candidate.id, { waitedFor: true });
        }
        return true;
      });
      if (moved) settled += 1;
    } catch (error) {
      // One row's fault defers that row to the next tick; the rows after it
      // are still settled.
      console.warn(
        '[watchdog] settling a lost document read failed; the next tick tries again',
        {
          fileId: candidate.id,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  }
  if (settled > 0) {
    console.info(
      `[watchdog] settled ${settled} lost document read(s); their index decides`,
    );
  }
  return settled;
}

/** Whether pg-boss holds an index job for the file that has yet to finish —
 * one a door other than an upload's queued, which a lost read must not
 * double. */
async function indexJobWaiting(
  tx: TransactionSql,
  fileId: string,
): Promise<boolean> {
  const rows = await tx<{ found: number }[]>`
    SELECT 1 AS found FROM pgboss.job
    WHERE name = 'rag.index_file' AND data ->> 'fileId' = ${fileId}
      AND state IN ('created', 'retry', 'active')
    LIMIT 1
  `;
  return rows.length > 0;
}
