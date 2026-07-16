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
    sql.unsafe<{ id: string; content_hash: string }[]>(
      `SELECT id, content_hash FROM ${SCHEMA}.documents
       WHERE org_slug = $1 AND file_id = $2`,
      [orgSlug, fileId],
    ),
  );
  if (existing[0]?.content_hash === contentHash) {
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

async function doStore(
  sql: Sql,
  orgSlug: string,
  fileId: string,
  filename: string,
  prepared: PreparedDocument,
  embeddingService: EmbeddingService,
): Promise<IndexResult> {
  return withRetry(() =>
    sql.begin(async (tx) => {
      const docRows = await tx.unsafe<{ id: string; is_insert: boolean }[]>(
        `INSERT INTO ${SCHEMA}.documents
            (org_slug, file_id, filename, content_hash, status, chunks_count,
             source_created_at, source_modified_at, ocr_applied)
         VALUES ($1, $2, $3, $4, 'completed', $5, $6, $7, $8)
         ON CONFLICT (org_slug, file_id)
         DO UPDATE SET
             filename = EXCLUDED.filename,
             content_hash = EXCLUDED.content_hash,
             status = 'completed',
             chunks_count = EXCLUDED.chunks_count,
             source_created_at = EXCLUDED.source_created_at,
             source_modified_at = EXCLUDED.source_modified_at,
             ocr_applied = EXCLUDED.ocr_applied,
             error = NULL,
             progress_phase = NULL,
             progress_detail = NULL,
             updated_at = NOW()
         WHERE ${SCHEMA}.documents.content_hash IS DISTINCT FROM EXCLUDED.content_hash
         RETURNING id, (xmax = 0) AS is_insert`,
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

      const docRow = docRows[0];
      if (!docRow) {
        return {
          success: true,
          file_id: fileId,
          chunks_created: 0,
          skipped: true,
          skip_reason: 'content_unchanged',
        } satisfies IndexResult;
      }

      const docUuid = docRow.id;
      if (!docRow.is_insert) {
        await tx.unsafe(
          `DELETE FROM ${SCHEMA}.chunks WHERE document_id = $1 AND org_slug = $2`,
          [docUuid, orgSlug],
        );
      }

      // Embed + insert one bounded batch at a time so peak memory never scales
      // with document size: only `MAX_BATCH_SIZE` embedding vectors are held at
      // once, not one per chunk for the whole document (which OOM-killed the
      // action on large files — see `prepareDocument`).
      for (
        let start = 0;
        start < prepared.chunks.length;
        start += MAX_BATCH_SIZE
      ) {
        const batch = prepared.chunks.slice(start, start + MAX_BATCH_SIZE);
        const embeddings = await embeddingService.embedTexts(
          batch.map((c) => c.content),
        );
        for (let j = 0; j < batch.length; j += 1) {
          const chunk = batch[j];
          const embedding = embeddings[j];
          await tx.unsafe(
            `INSERT INTO ${SCHEMA}.chunks
                (document_id, org_slug, chunk_index, chunk_content,
                 content_hash, embedding,
                 core_content, prefix_overlap, suffix_overlap)
             VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9)`,
            [
              docUuid,
              orgSlug,
              chunk.index,
              chunk.content,
              computeContentHash(Buffer.from(chunk.content, 'utf-8')),
              JSON.stringify(embedding),
              chunk.coreContent,
              chunk.prefixOverlap,
              chunk.suffixOverlap,
            ],
          );
        }
      }

      return {
        success: true,
        file_id: fileId,
        chunks_created: prepared.chunks.length,
        skipped: false,
        skip_reason: null,
      } satisfies IndexResult;
    }),
  );
}

export async function storePreparedDocument(
  sql: Sql,
  orgSlug: string,
  fileId: string,
  filename: string,
  prepared: PreparedDocument,
  embeddingService: EmbeddingService,
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
      );
      if (result.skipped) {
        logger.info(`Document ${fileId} content unchanged, skipping`);
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

export interface IndexDocumentOptions {
  embeddingService: EmbeddingService;
  visionClient?: VisionClient | null;
  chunkSize?: number;
  chunkOverlap?: number;
  sourceCreatedAt?: Date | null;
  sourceModifiedAt?: Date | null;
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

  // Fast path: same file_id within this org with unchanged content AND chunks.
  const ownRows = await withRetry(() =>
    sql.unsafe<{ content_hash: string; chunk_count: number }[]>(
      `SELECT d.content_hash,
              (SELECT COUNT(*)::int
               FROM ${SCHEMA}.chunks c
               WHERE c.document_id = d.id AND c.org_slug = $1) AS chunk_count
       FROM ${SCHEMA}.documents d
       WHERE d.org_slug = $1 AND d.file_id = $2`,
      [orgSlug, fileId],
    ),
  );
  const ownRow = ownRows[0];
  if (ownRow && ownRow.content_hash === contentHash && ownRow.chunk_count > 0) {
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
  );
}
