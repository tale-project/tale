'use node';

/**
 * Writing a document into the `private_knowledge` corpus.
 *
 * Text arrives already extracted — this module does not know about PDFs, OCR,
 * or crawlers, and the ingestion pipelines that produce text call in here. That
 * boundary is what keeps the crawler and video paths free to be rewired without
 * touching retrieval.
 *
 * Three behaviours here are not optimizations; each one exists because its
 * absence broke something:
 *
 *  - **The secret scan runs first.** A credential that reaches the corpus will
 *    eventually be read back into a model's context and spoken aloud. Deleting
 *    the document afterwards does not undo that, so a file that looks like it
 *    contains one is refused before it is chunked.
 *  - **Content-hash dedup.** Re-uploading, re-syncing, and retrying are all
 *    normal, and indexing is the expensive part of the system. Unchanged
 *    content is skipped; content already embedded elsewhere in the SAME
 *    organization is copied rather than re-embedded.
 *  - **Slices resume.** A large document takes longer to index than one
 *    invocation may run, so chunks are committed in slices and the committed
 *    prefix is the checkpoint. Without that, a document past the window could
 *    never finish: every attempt would redo the previous attempt's work and run
 *    out of time in the same place.
 *
 * The document row stays `processing` — with its `updated_at` touched on every
 * committed slice, so a watchdog can tell live work from abandoned work — until
 * the last slice stamps it `completed`.
 */

import { computeContentHash } from '@tale/shared/utils/hashing';
import type { Sql } from 'postgres';

import {
  chunkDocument,
  type ContextualChunk,
} from '../../lib/knowledge/chunking';
import { planIngest, sliceToStore } from '../../lib/knowledge/ingest-plan';
import { logger } from '../../lib/knowledge/logger';
import { scanForSecrets } from '../../lib/knowledge/secret-scan';
import { PRIVATE_KNOWLEDGE_SCHEMA as SCHEMA } from '../../lib/knowledge/types';
import type { PiiConfig } from '../../lib/shared/schemas/pii';
import { assertVectorWidth } from './dimensions';
import type { Embedder } from './embedding';
import { applyPiiPolicyForIndexing } from './pii_gate';

/** Chunks committed per slice. Small enough that a slice fits comfortably in
 * one invocation's budget, large enough that the per-slice overhead is noise. */
export const CHUNKS_PER_SLICE = 64;

export interface IndexDocumentArgs {
  readonly sql: Sql;
  readonly orgSlug: string;
  /** The organization's own identifier for the document. */
  readonly fileId: string;
  readonly filename: string;
  /** The document's text, already extracted. */
  readonly text: string;
  /** The original bytes, scanned for credentials before anything is stored.
   * Omitted when the caller has already scanned them. */
  readonly bytes?: Uint8Array;
  readonly embedder: Embedder;
  /**
   * The organization's PII policy, already parsed. Absent or disabled indexes
   * exactly as before. Passed in rather than read here because this module has
   * no Convex ctx — the caller resolves it once per file.
   */
  readonly piiConfig?: PiiConfig | null;
  readonly folderPath?: string | null;
  /**
   * Document scope, from the Convex document row (`teamTags`/`projectId` —
   * mutually exclusive; empty/null teams AND null project = org hub).
   * `teamIds` is the FULL team list of a shared document; the corpus row is
   * stamped with the array (`team_ids`) plus the deprecated single-column
   * mirror (`team_id` = first element) so retrieval can filter by the
   * caller's visibility. Scope-only changes are synced separately
   * (`syncRagDocumentScopes`) without re-embedding.
   */
  readonly teamIds?: readonly string[] | null;
  readonly projectId?: string | null;
  /**
   * The conversation an emailed attachment arrived on, when the file IS one.
   *
   * A third scope dimension rather than a value folded into the two above,
   * because it is not an answer: conversation visibility is decided live from
   * the conversation's current assignment, so the row records only which
   * conversation to ask about. Its other job is to keep the row out of the hub
   * clause — every scope column NULL reads as org-wide.
   */
  readonly conversationId?: string | null;
  /**
   * What the chunk header announces, when it should differ from `filename`.
   *
   * `filename` is what the corpus row stores and the UI shows; this is what
   * the header prepended to every chunk says. They are the same for a Document
   * Hub file. They differ for an emailed attachment, whose header carries the
   * mail it arrived on — a CV named for its author says nothing about the role
   * it was sent for, and the subject line usually does. The header feeds BOTH
   * the keyword leg and the embedding, so this widens retrieval on both.
   */
  readonly title?: string;
  readonly sourceCreatedAt?: Date | null;
  readonly sourceModifiedAt?: Date | null;
  /** Chunks to commit in this invocation. */
  readonly maxChunks?: number;
}

export interface IndexDocumentResult {
  readonly fileId: string;
  /** Chunks written by THIS invocation. */
  readonly chunksWritten: number;
  /** Chunks the document has in total. */
  readonly chunksTotal: number;
  /** True when the slice budget ran out — the caller schedules a continuation,
   * which resumes after the committed prefix. */
  readonly partial: boolean;
  /** Set when nothing was done, and why. */
  readonly skipped?: 'unchanged' | 'secret-detected' | 'empty' | 'pii-blocked';
  /** Present when the upload was refused, in words for the person who made it. */
  readonly refusal?: string;
}

/**
 * Index one document, committing at most one slice of chunks.
 *
 * Returns `partial: true` when chunks remain; calling again with the same
 * arguments resumes where this call stopped.
 */
export async function indexDocument(
  args: IndexDocumentArgs,
): Promise<IndexDocumentResult> {
  if (args.bytes !== undefined) {
    const scan = scanForSecrets(args.bytes);
    if (scan.rejected) {
      await markFailed(args.sql, args.orgSlug, args.fileId, scan.reason);
      return {
        fileId: args.fileId,
        chunksWritten: 0,
        chunksTotal: 0,
        partial: false,
        skipped: 'secret-detected',
        ...(scan.reason !== null && { refusal: scan.reason }),
      };
    }
  }

  // The organization's own PII policy, applied before anything is chunked or
  // embedded — so a masked identifier never reaches the vectors, and a blocked
  // document never reaches the index at all.
  const decision = applyPiiPolicyForIndexing(args.text, args.piiConfig ?? null);
  if (decision.kind === 'refuse') {
    const reason = `Indexing refused by the organization's PII policy (${decision.categoryIds.join(', ')}).`;
    await markFailed(args.sql, args.orgSlug, args.fileId, reason);
    return {
      fileId: args.fileId,
      chunksWritten: 0,
      chunksTotal: 0,
      partial: false,
      skipped: 'pii-blocked',
      refusal: reason,
    };
  }

  const chunks = chunkDocument(decision.text, {
    title: args.title ?? args.filename,
  });
  if (chunks.length === 0) {
    return {
      fileId: args.fileId,
      chunksWritten: 0,
      chunksTotal: 0,
      partial: false,
      skipped: 'empty',
    };
  }

  // Hashed AFTER the policy, not before. The hash is the content's identity:
  // skip-if-unchanged and the duplicate-clone lookup both key on it. Hashing
  // the raw text would make a policy change invisible — the same file would
  // read as unchanged and keep its old, less-masked chunks forever.
  const contentHash = computeContentHash(decision.text);
  const stored = await readStoredState(args.sql, args.orgSlug, args.fileId);
  const duplicate = await findDuplicate(
    args.sql,
    args.orgSlug,
    contentHash,
    args.fileId,
  );
  const plan = planIngest({
    contentHash,
    totalChunks: chunks.length,
    stored,
    duplicateOf: duplicate,
  });

  if (plan.action === 'skip') {
    logger.info(
      `document "${args.fileId}" is unchanged and fully indexed; nothing to do`,
    );
    return {
      fileId: args.fileId,
      chunksWritten: 0,
      chunksTotal: chunks.length,
      partial: false,
      skipped: 'unchanged',
    };
  }

  const documentId = await claimDocumentRow({
    sql: args.sql,
    orgSlug: args.orgSlug,
    fileId: args.fileId,
    filename: args.filename,
    contentHash,
    chunksTotal: chunks.length,
    folderPath: args.folderPath ?? null,
    teamIds: args.teamIds ?? null,
    projectId: args.projectId ?? null,
    conversationId: args.conversationId ?? null,
    sourceCreatedAt: args.sourceCreatedAt ?? null,
    sourceModifiedAt: args.sourceModifiedAt ?? null,
    // Only content that is actually the same keeps its committed chunks.
    keepChunks: plan.action === 'resume',
  });

  if (plan.action === 'clone') {
    const copied = await cloneChunks(
      args.sql,
      args.orgSlug,
      plan.sourceDocumentId,
      documentId,
    );
    await markCompleted(args.sql, args.orgSlug, documentId, copied);
    logger.info(
      `document "${args.fileId}" matched content already indexed for this organization; copied ${copied} chunks instead of re-embedding`,
    );
    return {
      fileId: args.fileId,
      chunksWritten: copied,
      chunksTotal: copied,
      partial: false,
    };
  }

  const from = plan.action === 'resume' ? plan.fromChunk : 0;
  const slice = sliceToStore(
    chunks.length,
    from,
    args.maxChunks ?? CHUNKS_PER_SLICE,
  );
  const window = chunks.slice(slice.from, slice.to);

  if (window.length > 0) {
    const vectors = await args.embedder.embedAll(
      window.map((chunk) => chunk.embedText),
    );
    for (const vector of vectors) {
      assertVectorWidth(
        vector,
        args.embedder.dimensions,
        `the embedding model "${args.embedder.model.model}"`,
      );
    }
    await writeChunks({
      sql: args.sql,
      orgSlug: args.orgSlug,
      documentId,
      chunks: window,
      vectors,
    });
  }

  if (slice.done) {
    await markCompleted(args.sql, args.orgSlug, documentId, chunks.length);
  }

  return {
    fileId: args.fileId,
    chunksWritten: window.length,
    chunksTotal: chunks.length,
    partial: !slice.done,
  };
}

/** What the corpus already holds for this document reference. */
async function readStoredState(
  sql: Sql,
  orgSlug: string,
  fileId: string,
): Promise<
  import('../../lib/knowledge/ingest-plan').StoredDocumentState | null
> {
  const rows = await sql.unsafe<
    {
      id: string;
      content_hash: string | null;
      status: string;
      stored: number;
    }[]
  >(
    `SELECT d.id, d.content_hash, d.status,
            COALESCE((SELECT MAX(c.chunk_index) + 1
                      FROM ${SCHEMA}.chunks c
                      WHERE c.document_id = d.id AND c.org_slug = d.org_slug), 0)::int AS stored
     FROM ${SCHEMA}.documents d
     WHERE d.org_slug = $1 AND d.file_id = $2`,
    [orgSlug, fileId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    contentHash: row.content_hash,
    status: asStatus(row.status),
    storedChunks: row.stored,
  };
}

/**
 * A completed document in the SAME organization holding identical content.
 *
 * Scoped by `org_slug` like every other statement: reusing another
 * organization's embeddings would both copy its content and reveal that it has
 * the same file.
 */
async function findDuplicate(
  sql: Sql,
  orgSlug: string,
  contentHash: string,
  exceptFileId: string,
): Promise<string | null> {
  const rows = await sql.unsafe<{ id: string }[]>(
    `SELECT id FROM ${SCHEMA}.documents
     WHERE org_slug = $1 AND content_hash = $2 AND status = 'completed'
       AND file_id <> $3
     LIMIT 1`,
    [orgSlug, contentHash, exceptFileId],
  );
  return rows[0]?.id ?? null;
}

/**
 * Create or refresh the document row in one short transaction, and return its
 * id.
 *
 * `keepChunks` is what makes resuming work: the committed chunks survive when
 * the content is unchanged, and are discarded when it is not — new content has
 * different chunk boundaries, so keeping the old prefix would splice two
 * documents together.
 */
async function claimDocumentRow(args: {
  sql: Sql;
  orgSlug: string;
  fileId: string;
  filename: string;
  contentHash: string;
  chunksTotal: number;
  folderPath: string | null;
  teamIds: readonly string[] | null;
  projectId: string | null;
  conversationId: string | null;
  sourceCreatedAt: Date | null;
  sourceModifiedAt: Date | null;
  keepChunks: boolean;
}): Promise<string> {
  // The full team list drives retrieval (`team_ids && caller_teams`); the
  // single `team_id` column stays stamped with the first element as a
  // deprecated mirror for anything still reading it during the transition.
  const teamIds =
    args.teamIds !== null && args.teamIds.length > 0 ? [...args.teamIds] : null;
  return args.sql.begin(async (tx) => {
    const rows = await tx.unsafe<{ id: string }[]>(
      `INSERT INTO ${SCHEMA}.documents
          (org_slug, file_id, filename, content_hash, status, chunks_count,
           folder_path, team_ids, team_id, project_id, conversation_id,
           source_created_at, source_modified_at)
       VALUES ($1, $2, $3, $4, 'processing', $5, $6, $7::text[], $8, $9, $10,
               $11, $12)
       ON CONFLICT (org_slug, file_id) DO UPDATE SET
           filename = EXCLUDED.filename,
           content_hash = EXCLUDED.content_hash,
           status = 'processing',
           chunks_count = EXCLUDED.chunks_count,
           folder_path = EXCLUDED.folder_path,
           team_ids = EXCLUDED.team_ids,
           team_id = EXCLUDED.team_id,
           project_id = EXCLUDED.project_id,
           conversation_id = EXCLUDED.conversation_id,
           source_created_at = EXCLUDED.source_created_at,
           source_modified_at = EXCLUDED.source_modified_at,
           error = NULL,
           updated_at = NOW()
       RETURNING id`,
      [
        args.orgSlug,
        args.fileId,
        args.filename,
        args.contentHash,
        args.chunksTotal,
        args.folderPath,
        teamIds,
        teamIds?.[0] ?? null,
        args.projectId,
        args.conversationId,
        args.sourceCreatedAt,
        args.sourceModifiedAt,
      ],
    );
    const documentId = rows[0].id;
    if (!args.keepChunks) {
      await tx.unsafe(
        `DELETE FROM ${SCHEMA}.chunks WHERE document_id = $1 AND org_slug = $2`,
        [documentId, args.orgSlug],
      );
    }
    return documentId;
  });
}

/** Commit one slice of chunks. */
async function writeChunks(args: {
  sql: Sql;
  orgSlug: string;
  documentId: string;
  chunks: readonly ContextualChunk[];
  vectors: readonly number[][];
}): Promise<void> {
  await args.sql.begin(async (tx) => {
    for (const [position, chunk] of args.chunks.entries()) {
      await tx.unsafe(
        `INSERT INTO ${SCHEMA}.chunks
            (document_id, org_slug, chunk_index, chunk_content, content_hash,
             embedding, context_header, core_content, prefix_overlap, suffix_overlap)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9, $10)
         ON CONFLICT (document_id, chunk_index) DO UPDATE SET
             chunk_content = EXCLUDED.chunk_content,
             content_hash = EXCLUDED.content_hash,
             embedding = EXCLUDED.embedding,
             context_header = EXCLUDED.context_header,
             core_content = EXCLUDED.core_content,
             prefix_overlap = EXCLUDED.prefix_overlap,
             suffix_overlap = EXCLUDED.suffix_overlap`,
        [
          args.documentId,
          args.orgSlug,
          chunk.index,
          // The stored text carries the contextual header, so a passage
          // retrieved on its own still says where it came from — and so the
          // keyword index matches on it too.
          chunk.embedText,
          computeContentHash(chunk.text),
          JSON.stringify(args.vectors[position] ?? []),
          chunk.header,
          chunk.core,
          chunk.prefixOverlap,
          chunk.suffixOverlap,
        ],
      );
    }
    // Touching the row is what tells a watchdog this run is alive rather than
    // abandoned mid-slice.
    await tx.unsafe(
      `UPDATE ${SCHEMA}.documents SET updated_at = NOW()
       WHERE id = $1 AND org_slug = $2`,
      [args.documentId, args.orgSlug],
    );
  });
}

/** Copy an identical document's chunks and embeddings. */
async function cloneChunks(
  sql: Sql,
  orgSlug: string,
  sourceDocumentId: string,
  targetDocumentId: string,
): Promise<number> {
  const rows = await sql.unsafe<{ count: number }[]>(
    `WITH copied AS (
       INSERT INTO ${SCHEMA}.chunks
           (document_id, org_slug, chunk_index, chunk_content, content_hash,
            embedding, context_header, core_content, prefix_overlap, suffix_overlap)
       SELECT $1, $2, chunk_index, chunk_content, content_hash, embedding,
              context_header, core_content, prefix_overlap, suffix_overlap
       FROM ${SCHEMA}.chunks
       WHERE document_id = $3 AND org_slug = $2
       ON CONFLICT (document_id, chunk_index) DO NOTHING
       RETURNING 1
     )
     SELECT count(*)::int AS count FROM copied`,
    [targetDocumentId, orgSlug, sourceDocumentId],
  );
  return rows[0]?.count ?? 0;
}

async function markCompleted(
  sql: Sql,
  orgSlug: string,
  documentId: string,
  chunksTotal: number,
): Promise<void> {
  await sql.unsafe(
    `UPDATE ${SCHEMA}.documents
     SET status = 'completed', chunks_count = $3, error = NULL,
         progress_phase = NULL, progress_detail = NULL, updated_at = NOW()
     WHERE id = $1 AND org_slug = $2`,
    [documentId, orgSlug, chunksTotal],
  );
}

/** Record a refusal on the document row so the reason survives the invocation
 * that produced it. */
async function markFailed(
  sql: Sql,
  orgSlug: string,
  fileId: string,
  reason: string | null,
): Promise<void> {
  await sql.unsafe(
    `INSERT INTO ${SCHEMA}.documents (org_slug, file_id, status, error)
     VALUES ($1, $2, 'failed', $3)
     ON CONFLICT (org_slug, file_id) DO UPDATE SET
         status = 'failed', error = EXCLUDED.error, updated_at = NOW()`,
    [orgSlug, fileId, reason],
  );
}

function asStatus(value: string): 'processing' | 'completed' | 'failed' {
  return value === 'completed' || value === 'failed' ? value : 'processing';
}
