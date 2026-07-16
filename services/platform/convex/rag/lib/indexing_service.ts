'use node';

/**
 * Document indexing service for the RAG pipeline.
 *
 * Pipeline: extract text -> chunk -> embed -> store in private_knowledge.
 * Content-hash dedup skips re-processing unchanged documents; same-content
 * documents in the same org are cloned rather than re-embedded.
 *
 * PDF/DOCX/PPTX source date extraction is ported from the Python service:
 * PDF dates are read from the raw `/CreationDate` `/ModDate` trailer entries;
 * DOCX/PPTX dates from `docProps/core.xml` via the knowledge GuardedZip reader.
 */

import JSZip from 'jszip';
import type { Sql } from 'postgres';

import {
  chunkContent,
  type ContentChunk,
} from '../../lib/knowledge/chunking/splitter';
import {
  isInternalError,
  PRIVATE_KNOWLEDGE_SCHEMA as SCHEMA,
} from '../../lib/knowledge/db/knowledge_db';
import { withRetry } from '../../lib/knowledge/db/retry';
import {
  type EmbeddingService,
  MAX_BATCH_SIZE,
} from '../../lib/knowledge/embedding/service';
import { extractText } from '../../lib/knowledge/extraction/router';
import { logger } from '../../lib/knowledge/logger';
import { computeContentHash } from '../../lib/knowledge/utils/hashing';
import type { VisionClient } from '../../lib/knowledge/vision/client';
import { scanFileForSecrets } from './secret_scanner';

const HNSW_INDEX = `${SCHEMA}.idx_pk_chunks_embedding_hnsw`;
const HNSW_CORRUPTION_MARKER = 'should be empty but is not';
const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

export interface IndexResult {
  success: boolean;
  file_id: string;
  chunks_created: number;
  skipped: boolean;
  skip_reason: string | null;
  /**
   * True when a `deadline` stopped the store loop before every chunk was
   * committed. The document row stays `processing` with its committed chunk
   * prefix in place; the caller schedules a continuation, which resumes from
   * `MAX(chunk_index) + 1` (#2752 — never re-run the whole pipeline inside one
   * wall-clock-capped action).
   */
  partial?: boolean;
  /** Total chunks the document produces (present alongside `partial`). */
  chunks_total?: number;
}

export interface PreparedDocument {
  contentHash: string;
  chunks: ContentChunk[];
  visionUsed: boolean;
  sourceCreatedAt: Date | null;
  sourceModifiedAt: Date | null;
}

const PDF_DATE_RE =
  /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Z+-])?(\d{2})?'?(\d{2})?'?/;

/** Parse a PDF date string `D:YYYYMMDDHHmmSSOHH'mm'` to a Date (UTC). */
export function parsePdfDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }
  const match = PDF_DATE_RE.exec(dateStr.trim());
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return null;
  }
  const month = Number(match[2] ?? '01');
  const day = Number(match[3] ?? '01');
  const hour = Number(match[4] ?? '00');
  const minute = Number(match[5] ?? '00');
  const second = Number(match[6] ?? '00');

  const tzSign = match[7];
  const tzHours = Number(match[8] ?? '0');
  const tzMinutes = Number(match[9] ?? '0');

  let offsetMinutes = 0;
  if (tzSign === '-') {
    offsetMinutes = -(tzHours * 60 + tzMinutes);
  } else if (tzSign === '+') {
    offsetMinutes = tzHours * 60 + tzMinutes;
  }

  // Compose UTC instant: local-wall-clock minus the offset.
  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, second) -
    offsetMinutes * 60 * 1000;
  const date = new Date(utcMs);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function ensureAware(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function fileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx + 1).toLowerCase() : '';
}

function findPdfDate(text: string, key: string): string | null {
  // Match `/CreationDate (D:...)` or `/CreationDate <hex>` (we only read the
  // common parenthesized literal form PDF writers emit).
  const re = new RegExp(`/${key}\\s*\\(([^)]*)\\)`);
  const match = re.exec(text);
  return match ? match[1] : null;
}

function extractCorePropDate(coreXml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`);
  const match = re.exec(coreXml);
  return match ? match[1] : null;
}

/** Extract created/modified dates from PDF, DOCX, or PPTX bytes. */
export async function extractFileDates(
  contentBytes: Uint8Array,
  filename: string,
): Promise<[Date | null, Date | null]> {
  const ext = fileExtension(filename);
  try {
    if (ext === 'pdf') {
      // Read the trailing portion where the Info dictionary usually lives,
      // falling back to the whole document for small files.
      const text = Buffer.from(contentBytes).toString('latin1');
      return [
        parsePdfDate(findPdfDate(text, 'CreationDate')),
        parsePdfDate(findPdfDate(text, 'ModDate')),
      ];
    }
    if (ext === 'docx' || ext === 'pptx') {
      const zip = await JSZip.loadAsync(contentBytes);
      const coreFile = zip.file('docProps/core.xml');
      if (!coreFile) {
        return [null, null];
      }
      const coreXml = await coreFile.async('string');
      return [
        ensureAware(extractCorePropDate(coreXml, 'dcterms:created')),
        ensureAware(extractCorePropDate(coreXml, 'dcterms:modified')),
      ];
    }
  } catch {
    logger.warn(`Could not extract dates from ${filename}`);
  }
  return [null, null];
}

async function updateProgress(
  sql: Sql,
  orgSlug: string,
  fileId: string,
  phase: string,
  detail: string,
): Promise<void> {
  try {
    await withRetry(async () => {
      await sql.unsafe(
        `UPDATE ${SCHEMA}.documents
         SET progress_phase = $3, progress_detail = $4, updated_at = NOW()
         WHERE org_slug = $1 AND file_id = $2 AND status = 'processing'`,
        [orgSlug, fileId, phase, detail],
      );
    });
  } catch {
    logger.debug(`Failed to update progress for ${orgSlug}/${fileId}`);
  }
}

function makeExtractionProgressCallback(
  sql: Sql,
  orgSlug: string,
  fileId: string,
  minIntervalMs = 3000,
): (pagesDone: number, totalPages: number) => void {
  let lastFlush = 0;
  return (pagesDone: number, totalPages: number): void => {
    const now = performance.now();
    if (now - lastFlush < minIntervalMs && pagesDone < totalPages) {
      return;
    }
    lastFlush = now;
    void updateProgress(
      sql,
      orgSlug,
      fileId,
      'extracting',
      `${pagesDone}/${totalPages}`,
    );
  };
}

export interface PrepareDocumentOptions {
  visionClient?: VisionClient | null;
  chunkSize?: number;
  chunkOverlap?: number;
  onProgress?: (pagesDone: number, totalPages: number) => void;
}

/**
 * Extract and chunk a document. Returns null if no usable text.
 *
 * Embedding is deliberately NOT done here: a large document (e.g. a 100 MB
 * text file → tens of thousands of chunks) would otherwise materialize every
 * embedding vector in memory at once (~600 MB at 1536 dims, more at 4096),
 * OOM-killing the Convex action before it can store anything. `storePreparedDocument`
 * embeds one bounded batch at a time as it inserts, so peak memory stays flat
 * regardless of document size.
 */
export async function prepareDocument(
  contentBytes: Uint8Array,
  filename: string,
  options: PrepareDocumentOptions,
): Promise<PreparedDocument | null> {
  const contentHash = computeContentHash(contentBytes);

  const [extractedText, visionUsed] = await extractText(
    contentBytes,
    filename,
    {
      visionClient: options.visionClient ?? null,
      onProgress: options.onProgress,
    },
  );

  const [sourceCreatedAt, sourceModifiedAt] = await extractFileDates(
    contentBytes,
    filename,
  );

  if (!extractedText || !extractedText.trim()) {
    logger.warn(`No text extracted from ${filename}`);
    return null;
  }

  const chunks = chunkContent(extractedText, {
    chunkSize: options.chunkSize ?? 2048,
    chunkOverlap: options.chunkOverlap ?? 200,
  });

  if (chunks.length === 0) {
    logger.warn(`No chunks produced from ${filename}`);
    return null;
  }

  return {
    contentHash,
    chunks,
    visionUsed,
    sourceCreatedAt,
    sourceModifiedAt,
  };
}

/** Find a completed document with the given content hash within `org_slug`. */
export async function findExistingByHash(
  sql: Sql,
  orgSlug: string,
  contentHash: string,
): Promise<string | null> {
  const rows = await withRetry(() =>
    sql.unsafe<{ id: string }[]>(
      `SELECT id FROM ${SCHEMA}.documents
       WHERE org_slug = $1 AND content_hash = $2 AND status = 'completed'
       LIMIT 1`,
      [orgSlug, contentHash],
    ),
  );
  return rows[0]?.id ?? null;
}

async function reindexChunksHnsw(sql: Sql): Promise<void> {
  logger.warn(`HNSW index corruption detected — rebuilding ${HNSW_INDEX}`);
  await withRetry(() => sql.unsafe(`REINDEX INDEX ${HNSW_INDEX}`));
  logger.info('HNSW index rebuild completed');
}

function isHnswCorruption(err: unknown): boolean {
  return (
    isInternalError(err) &&
    err instanceof Error &&
    err.message.includes(HNSW_CORRUPTION_MARKER)
  );
}

interface DocSource {
  chunks_count: number;
  source_created_at: Date | null;
  source_modified_at: Date | null;
}

async function doClone(
  sql: Sql,
  orgSlug: string,
  sourceDocId: string,
  fileId: string,
  filename: string,
  contentHash: string,
  sourceCreatedAt: Date | null,
  sourceModifiedAt: Date | null,
): Promise<IndexResult | null> {
  return withRetry(() =>
    sql.begin(async (tx) => {
      const source = await tx.unsafe<DocSource[]>(
        `SELECT chunks_count, source_created_at, source_modified_at
         FROM ${SCHEMA}.documents
         WHERE id = $1 AND org_slug = $2 AND status = 'completed'`,
        [sourceDocId, orgSlug],
      );
      if (source.length === 0) {
        return null;
      }
      const src = source[0];

      const docRows = await tx.unsafe<{ id: string; is_insert: boolean }[]>(
        `INSERT INTO ${SCHEMA}.documents
            (org_slug, file_id, filename, content_hash, status, chunks_count,
             source_created_at, source_modified_at)
         VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7)
         ON CONFLICT (org_slug, file_id)
         DO UPDATE SET
             filename = EXCLUDED.filename,
             content_hash = EXCLUDED.content_hash,
             status = 'completed',
             chunks_count = EXCLUDED.chunks_count,
             source_created_at = EXCLUDED.source_created_at,
             source_modified_at = EXCLUDED.source_modified_at,
             error = NULL,
             progress_phase = NULL,
             progress_detail = NULL,
             updated_at = NOW()
         RETURNING id, (xmax = 0) AS is_insert`,
        [
          orgSlug,
          fileId,
          filename,
          contentHash,
          src.chunks_count,
          sourceCreatedAt ?? src.source_created_at,
          sourceModifiedAt ?? src.source_modified_at,
        ],
      );
      const docRow = docRows[0];
      const docUuid = docRow.id;

      if (!docRow.is_insert) {
        await tx.unsafe(
          `DELETE FROM ${SCHEMA}.chunks WHERE document_id = $1 AND org_slug = $2`,
          [docUuid, orgSlug],
        );
      }

      const countRows = await tx.unsafe<{ count: number }[]>(
        `WITH inserted AS (
            INSERT INTO ${SCHEMA}.chunks
                (document_id, org_slug, chunk_index, chunk_content,
                 content_hash, embedding,
                 core_content, prefix_overlap, suffix_overlap)
            SELECT $1, $2, chunk_index, chunk_content, content_hash, embedding,
                   core_content, prefix_overlap, suffix_overlap
            FROM ${SCHEMA}.chunks
            WHERE document_id = $3 AND org_slug = $2
            RETURNING 1
         )
         SELECT count(*)::int AS count FROM inserted`,
        [docUuid, orgSlug, sourceDocId],
      );

      return {
        success: true,
        file_id: fileId,
        chunks_created: countRows[0]?.count ?? 0,
        skipped: false,
        skip_reason: null,
      } satisfies IndexResult;
    }),
  );
}

async function cloneFromExisting(
  sql: Sql,
  orgSlug: string,
  sourceDocId: string,
  fileId: string,
  filename: string,
  contentHash: string,
  sourceCreatedAt: Date | null,
  sourceModifiedAt: Date | null,
): Promise<IndexResult | null> {
  const existing = await withRetry(() =>
    sql.unsafe<{ id: string; content_hash: string; status: string }[]>(
      `SELECT id, content_hash, status FROM ${SCHEMA}.documents
       WHERE org_slug = $1 AND file_id = $2`,
      [orgSlug, fileId],
    ),
  );
  // Only a COMPLETED own row counts as unchanged — a `processing` row with the
  // same hash is a partially stored document (interrupted slice) that the
  // clone below (or the resume path) must finish (#2752).
  if (
    existing[0]?.content_hash === contentHash &&
    existing[0]?.status === 'completed'
  ) {
    logger.info(`Document ${fileId} content unchanged, skipping (clone path)`);
    return {
      success: true,
      file_id: fileId,
      chunks_created: 0,
      skipped: true,
      skip_reason: 'content_unchanged',
    };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await doClone(
        sql,
        orgSlug,
        sourceDocId,
        fileId,
        filename,
        contentHash,
        sourceCreatedAt,
        sourceModifiedAt,
      );
      if (result === null) {
        return null;
      }
      logger.info(
        `Cloned document ${fileId}: ${result.chunks_created} chunks (from source ${sourceDocId})`,
      );
      return result;
    } catch (err) {
      if (isHnswCorruption(err) && attempt === 0) {
        await reindexChunksHnsw(sql);
        continue;
      }
      throw err;
    }
  }
  return null;
}

interface StoreClaim {
  docUuid: string;
  /** First chunk index this run still has to store (committed prefix length). */
  resumeFrom: number;
  /** Content unchanged AND every chunk already committed — nothing to do. */
  skipped: boolean;
}

/**
 * Phase A — claim (or refresh) the document row in one SHORT transaction.
 *
 * The committed chunk prefix is the resume checkpoint (#2752): on an unchanged
 * content hash the existing chunks are kept and storing resumes after them; only
 * a CHANGED hash wipes the chunks for a full rewrite. The row stays
 * `processing` until phase C stamps `completed`.
 */
async function claimDocumentRow(
  sql: Sql,
  orgSlug: string,
  fileId: string,
  filename: string,
  prepared: PreparedDocument,
): Promise<StoreClaim> {
  return withRetry(() =>
    sql.begin(async (tx) => {
      const existing = await tx.unsafe<
        { id: string; content_hash: string | null; status: string }[]
      >(
        `SELECT id, content_hash, status FROM ${SCHEMA}.documents
         WHERE org_slug = $1 AND file_id = $2
         FOR UPDATE`,
        [orgSlug, fileId],
      );

      if (existing.length === 0) {
        const inserted = await tx.unsafe<{ id: string }[]>(
          `INSERT INTO ${SCHEMA}.documents
              (org_slug, file_id, filename, content_hash, status, chunks_count,
               source_created_at, source_modified_at, ocr_applied)
           VALUES ($1, $2, $3, $4, 'processing', $5, $6, $7, $8)
           RETURNING id`,
          [
            orgSlug,
            fileId,
            filename,
            prepared.contentHash,
            prepared.chunks.length,
            prepared.sourceCreatedAt,
            prepared.sourceModifiedAt,
            prepared.visionUsed,
          ],
        );
        return { docUuid: inserted[0].id, resumeFrom: 0, skipped: false };
      }

      const row = existing[0];
      const sameContent = row.content_hash === prepared.contentHash;
      const storedRows = await tx.unsafe<{ next_index: number }[]>(
        `SELECT COALESCE(MAX(chunk_index) + 1, 0)::int AS next_index
         FROM ${SCHEMA}.chunks WHERE document_id = $1 AND org_slug = $2`,
        [row.id, orgSlug],
      );
      const storedPrefix = sameContent ? (storedRows[0]?.next_index ?? 0) : 0;

      if (
        sameContent &&
        row.status === 'completed' &&
        storedPrefix >= prepared.chunks.length
      ) {
        return { docUuid: row.id, resumeFrom: storedPrefix, skipped: true };
      }

      await tx.unsafe(
        `UPDATE ${SCHEMA}.documents
         SET filename = $3, content_hash = $4, status = 'processing',
             chunks_count = $5, source_created_at = $6,
             source_modified_at = $7, ocr_applied = $8,
             error = NULL, updated_at = NOW()
         WHERE id = $1 AND org_slug = $2`,
        [
          row.id,
          orgSlug,
          filename,
          prepared.contentHash,
          prepared.chunks.length,
          prepared.sourceCreatedAt,
          prepared.sourceModifiedAt,
          prepared.visionUsed,
        ],
      );
      if (!sameContent) {
        await tx.unsafe(
          `DELETE FROM ${SCHEMA}.chunks WHERE document_id = $1 AND org_slug = $2`,
          [row.id, orgSlug],
        );
      }
      return { docUuid: row.id, resumeFrom: storedPrefix, skipped: false };
    }),
  );
}

/** Multi-row chunk INSERT (one statement per embed batch, 9 params per row). */
function buildChunkInsert(
  docUuid: string,
  orgSlug: string,
  batch: ContentChunk[],
  embeddings: number[][],
): { text: string; params: (string | number | null)[] } {
  const values: string[] = [];
  const params: (string | number | null)[] = [];
  for (let j = 0; j < batch.length; j += 1) {
    const chunk = batch[j];
    const base = params.length;
    values.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, ` +
        `$${base + 6}::vector, $${base + 7}, $${base + 8}, $${base + 9})`,
    );
    params.push(
      docUuid,
      orgSlug,
      chunk.index,
      chunk.content,
      computeContentHash(Buffer.from(chunk.content, 'utf-8')),
      JSON.stringify(embeddings[j]),
      chunk.coreContent,
      chunk.prefixOverlap,
      chunk.suffixOverlap,
    );
  }
  const text =
    `INSERT INTO ${SCHEMA}.chunks
        (document_id, org_slug, chunk_index, chunk_content,
         content_hash, embedding,
         core_content, prefix_overlap, suffix_overlap)
     VALUES ` + values.join(', ');
  return { text, params };
}

/** Phase B batch-commit outcome (see `storeBatch`). */
type BatchCommit = { kind: 'stored' | 'raced'; next: number } | null;

/**
 * Commit ONE embedded batch in its own short transaction. Under the row lock
 * the committed prefix is re-read: a concurrent indexer of the same document
 * (e.g. the historical double-dispatch of `uploadFileToRag` +
 * `uploadDocumentToRag`) may have advanced it — then this batch is dropped and
 * the caller continues from the new prefix, so the in-order prefix invariant
 * holds with any number of writers. Returns null when the document was
 * superseded (content hash changed under us) — the other writer owns it now.
 */
async function storeBatch(
  sql: Sql,
  orgSlug: string,
  docUuid: string,
  contentHash: string,
  totalChunks: number,
  start: number,
  batch: ContentChunk[],
  embeddings: number[][],
): Promise<BatchCommit> {
  return withRetry(() =>
    sql.begin(async (tx) => {
      const docRows = await tx.unsafe<{ content_hash: string | null }[]>(
        `SELECT content_hash FROM ${SCHEMA}.documents
         WHERE id = $1 AND org_slug = $2
         FOR UPDATE`,
        [docUuid, orgSlug],
      );
      if (docRows.length === 0 || docRows[0].content_hash !== contentHash) {
        return null;
      }
      const nextRows = await tx.unsafe<{ next_index: number }[]>(
        `SELECT COALESCE(MAX(chunk_index) + 1, 0)::int AS next_index
         FROM ${SCHEMA}.chunks WHERE document_id = $1 AND org_slug = $2`,
        [docUuid, orgSlug],
      );
      const next = nextRows[0]?.next_index ?? 0;
      if (next !== start) {
        return { kind: 'raced', next };
      }
      const insert = buildChunkInsert(docUuid, orgSlug, batch, embeddings);
      await tx.unsafe(insert.text, insert.params);
      await tx.unsafe(
        `UPDATE ${SCHEMA}.documents
         SET progress_phase = 'storing', progress_detail = $3, updated_at = NOW()
         WHERE id = $1 AND org_slug = $2`,
        [docUuid, orgSlug, `${start + batch.length}/${totalChunks}`],
      );
      return { kind: 'stored', next: start + batch.length };
    }),
  );
}

async function doStore(
  sql: Sql,
  orgSlug: string,
  fileId: string,
  filename: string,
  prepared: PreparedDocument,
  embeddingService: EmbeddingService,
  deadline: number | undefined,
): Promise<IndexResult> {
  const claim = await claimDocumentRow(
    sql,
    orgSlug,
    fileId,
    filename,
    prepared,
  );
  if (claim.skipped) {
    return {
      success: true,
      file_id: fileId,
      chunks_created: 0,
      skipped: true,
      skip_reason: 'content_unchanged',
    };
  }

  // Embed + commit one bounded batch at a time: memory stays flat regardless
  // of document size (#2744), and every committed batch is durable progress a
  // continuation resumes from (#2752) — the old single big transaction rolled
  // ALL chunks back when the action hit its wall-clock cap, leaving a large
  // document permanently unindexable on slow store/embed paths.
  let start = claim.resumeFrom;
  while (start < prepared.chunks.length) {
    // ≥1 batch commits per invocation before a deadline yield, so a
    // continuation chain always makes forward progress and cannot spin.
    if (
      deadline !== undefined &&
      start > claim.resumeFrom &&
      Date.now() > deadline
    ) {
      return {
        success: true,
        file_id: fileId,
        chunks_created: start - claim.resumeFrom,
        skipped: false,
        skip_reason: null,
        partial: true,
        chunks_total: prepared.chunks.length,
      };
    }
    const batch = prepared.chunks.slice(start, start + MAX_BATCH_SIZE);
    const embeddings = await embeddingService.embedTexts(
      batch.map((c) => c.content),
    );
    const committed = await storeBatch(
      sql,
      orgSlug,
      claim.docUuid,
      prepared.contentHash,
      prepared.chunks.length,
      start,
      batch,
      embeddings,
    );
    if (committed === null) {
      logger.warn(
        `Document ${fileId} superseded by a concurrent reindex, stopping this run`,
      );
      return {
        success: true,
        file_id: fileId,
        chunks_created: start - claim.resumeFrom,
        skipped: true,
        skip_reason: 'superseded_by_concurrent_reindex',
      };
    }
    start = committed.next;
  }

  await withRetry(async () => {
    await sql.unsafe(
      `UPDATE ${SCHEMA}.documents
       SET status = 'completed', chunks_count = $3, error = NULL,
           progress_phase = NULL, progress_detail = NULL, updated_at = NOW()
       WHERE id = $1 AND org_slug = $2 AND content_hash = $4`,
      [claim.docUuid, orgSlug, prepared.chunks.length, prepared.contentHash],
    );
  });

  return {
    success: true,
    file_id: fileId,
    chunks_created: prepared.chunks.length,
    skipped: false,
    skip_reason: null,
  };
}

export async function storePreparedDocument(
  sql: Sql,
  orgSlug: string,
  fileId: string,
  filename: string,
  prepared: PreparedDocument,
  embeddingService: EmbeddingService,
  options: { deadline?: number } = {},
): Promise<IndexResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await doStore(
        sql,
        orgSlug,
        fileId,
        filename,
        prepared,
        embeddingService,
        options.deadline,
      );
      if (result.partial) {
        logger.info(
          `Indexed document ${fileId}: ${result.chunks_created} chunks this slice, yielding for continuation`,
        );
      } else if (result.skipped) {
        logger.info(
          `Document ${fileId} ${result.skip_reason ?? 'skipped'}, skipping`,
        );
      } else {
        logger.info(
          `Indexed document ${fileId}: ${result.chunks_created} chunks`,
        );
      }
      return result;
    } catch (err) {
      if (isHnswCorruption(err) && attempt === 0) {
        await reindexChunksHnsw(sql);
        continue;
      }
      throw err;
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new Error('storePreparedDocument: exhausted retries');
}

/**
 * Mark a document `failed` with an honest error — used when a continuation
 * chain gives up (slice cap exceeded, unrecoverable slice error) so the row
 * never sticks at `processing` and the status poller can surface the failure.
 */
export async function markDocumentFailed(
  sql: Sql,
  orgSlug: string,
  fileId: string,
  error: string,
): Promise<void> {
  await withRetry(async () => {
    await sql.unsafe(
      `UPDATE ${SCHEMA}.documents
       SET status = 'failed', error = $3,
           progress_phase = NULL, progress_detail = NULL, updated_at = NOW()
       WHERE org_slug = $1 AND file_id = $2`,
      [orgSlug, fileId, error],
    );
  });
}

export interface IndexDocumentOptions {
  embeddingService: EmbeddingService;
  visionClient?: VisionClient | null;
  chunkSize?: number;
  chunkOverlap?: number;
  sourceCreatedAt?: Date | null;
  sourceModifiedAt?: Date | null;
  /**
   * Epoch-ms soft stop for the store loop: past it, the run commits its
   * current batch, returns `partial: true`, and the caller schedules a
   * continuation (#2752). Soft — extraction and the in-flight batch finish
   * first, so set it well inside the action's hard wall-clock cap.
   */
  deadline?: number;
}

/** Index a document: extract, chunk, embed, and store (with dedup/clone). */
export async function indexDocument(
  sql: Sql,
  orgSlug: string,
  fileId: string,
  contentBytes: Uint8Array,
  filename: string,
  options: IndexDocumentOptions,
): Promise<IndexResult> {
  const contentHash = computeContentHash(contentBytes);

  // Pre-ingestion secret scan: a file carrying credentials (API keys, private
  // keys, JWTs) must never be indexed or embedded. This restores the guard the
  // Python post-filter provided before the in-process port; the detector fails
  // open (allows on its own error), so a true `rejected` is a real match.
  const secretScan = scanFileForSecrets(contentBytes);
  if (secretScan.rejected) {
    logger.warn(
      `Document ${fileId} rejected by secret scanner: ${secretScan.reason}`,
    );
    await withRetry(() =>
      sql.unsafe(
        `UPDATE ${SCHEMA}.documents
         SET status = 'failed', error = $3,
             progress_phase = NULL, progress_detail = NULL, updated_at = NOW()
         WHERE org_slug = $1 AND file_id = $2`,
        [orgSlug, fileId, secretScan.reason],
      ),
    );
    return {
      success: false,
      file_id: fileId,
      chunks_created: 0,
      skipped: true,
      skip_reason: secretScan.reason,
    };
  }

  // Fast path: same file_id within this org with unchanged content AND a
  // COMPLETED index. A `processing` row with the same hash is a partially
  // stored document (an interrupted prior slice) — it must fall through to the
  // store path, which resumes after the committed chunk prefix (#2752).
  const ownRows = await withRetry(() =>
    sql.unsafe<{ content_hash: string; status: string; chunk_count: number }[]>(
      `SELECT d.content_hash, d.status,
              (SELECT COUNT(*)::int
               FROM ${SCHEMA}.chunks c
               WHERE c.document_id = d.id AND c.org_slug = $1) AS chunk_count
       FROM ${SCHEMA}.documents d
       WHERE d.org_slug = $1 AND d.file_id = $2`,
      [orgSlug, fileId],
    ),
  );
  const ownRow = ownRows[0];
  if (
    ownRow &&
    ownRow.content_hash === contentHash &&
    ownRow.status === 'completed' &&
    ownRow.chunk_count > 0
  ) {
    logger.info(
      `Document ${fileId} content unchanged with ${ownRow.chunk_count} chunks, skipping (early dedup)`,
    );
    await withRetry(() =>
      sql.unsafe(
        `UPDATE ${SCHEMA}.documents
         SET status = 'completed', error = NULL,
             progress_phase = NULL, progress_detail = NULL, updated_at = NOW()
         WHERE org_slug = $1 AND file_id = $2`,
        [orgSlug, fileId],
      ),
    );
    return {
      success: true,
      file_id: fileId,
      chunks_created: 0,
      skipped: true,
      skip_reason: 'content_unchanged',
    };
  }

  const sourceId = await findExistingByHash(sql, orgSlug, contentHash);
  if (sourceId !== null) {
    const result = await cloneFromExisting(
      sql,
      orgSlug,
      sourceId,
      fileId,
      filename,
      contentHash,
      options.sourceCreatedAt ?? null,
      options.sourceModifiedAt ?? null,
    );
    if (result !== null) {
      return result;
    }
    logger.warn(
      `Clone source ${sourceId} vanished, falling back to full processing`,
    );
  }

  const extractionCb = makeExtractionProgressCallback(sql, orgSlug, fileId);
  await updateProgress(sql, orgSlug, fileId, 'extracting', '');

  let prepared = await prepareDocument(contentBytes, filename, {
    visionClient: options.visionClient,
    chunkSize: options.chunkSize,
    chunkOverlap: options.chunkOverlap,
    onProgress: extractionCb,
  });

  if (prepared === null) {
    return {
      success: true,
      file_id: fileId,
      chunks_created: 0,
      skipped: true,
      skip_reason: 'no_text_extracted',
    };
  }

  await updateProgress(
    sql,
    orgSlug,
    fileId,
    'embedding',
    `${prepared.chunks.length} chunks`,
  );

  if (options.sourceCreatedAt != null || options.sourceModifiedAt != null) {
    prepared = {
      ...prepared,
      sourceCreatedAt: options.sourceCreatedAt ?? prepared.sourceCreatedAt,
      sourceModifiedAt: options.sourceModifiedAt ?? prepared.sourceModifiedAt,
    };
  }

  await updateProgress(sql, orgSlug, fileId, 'storing', '');

  return storePreparedDocument(
    sql,
    orgSlug,
    fileId,
    filename,
    prepared,
    options.embeddingService,
    { deadline: options.deadline },
  );
}
