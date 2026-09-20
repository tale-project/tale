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
 *  - **Slices resume.** A large document is committed in slices, and the
 *    committed prefix is the checkpoint: a crash resumes after it instead of
 *    starting over. Preparing the text — the secret scan, the PII policy,
 *    chunking, hashing — is a pass over the WHOLE document, so a caller that
 *    drives several slices pays it once (`indexWholeDocument`) rather than
 *    once per slice; a document of seventy slices used to be scanned and
 *    chunked seventy times over.
 *  - **A released document ends the run, quietly.** The corpus is keyed by
 *    blob ref, and a ref dies the moment its document is rewritten, replaced
 *    or deleted — the release seam (`domains/knowledge/release.ts`) then
 *    deletes the corpus row, often seconds after the job that indexes the
 *    same ref was queued. A run that finds its row gone stops as
 *    `released`: it never inserts chunks under a document that is not there
 *    (the FK violation that used to fail the job) and never claims a fresh
 *    row for the dead ref (the resurrection a later slice used to perform).
 *    The caller's own liveness question (`stillWanted`) is asked AFTER the
 *    claim, so a release that landed before the claim is seen by it and one
 *    landing after finds the claimed row and takes it.
 *
 * The document row stays `processing` — with its `updated_at` touched on every
 * committed slice, so a watchdog can tell live work from abandoned work — until
 * the last slice stamps it `completed`.
 */

import type { PiiConfig } from '@tale/shared/schemas/pii';
import { computeContentHash } from '@tale/shared/utils/hashing';
import type { Sql, TransactionSql } from 'postgres';

import {
  chunkDocument,
  type ContextualChunk,
} from '../../../lib/knowledge/chunking';
import { planIngest, sliceToStore } from '../../../lib/knowledge/ingest-plan';
import { logger } from '../../../lib/knowledge/logger';
import { sanitizeExtractedText } from '../../../lib/knowledge/sanitize-text';
import { scanForSecrets } from '../../../lib/knowledge/secret-scan';
import { PRIVATE_KNOWLEDGE_SCHEMA as SCHEMA } from '../../../lib/knowledge/types';
import { assertVectorWidth } from './dimensions';
import type { Embedder } from './embedding';
import { assertCorpusWritable } from './index_health';
import { applyPiiPolicyForIndexing } from './pii_gate';

/** Chunks committed per slice. Small enough that a slice fits comfortably in
 * one invocation's budget, large enough that the per-slice overhead is noise. */
export const CHUNKS_PER_SLICE = 64;

export interface IndexDocumentArgs {
  readonly sql: Sql;
  /** The corpus database's connection string — the key its write guard and
   * dimension pin are kept under (`resolveOrgUrl`). Never logged. */
  readonly dbUrl: string;
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
  /**
   * The document as `prepareDocument` made it ready — computed once by a
   * caller that drives several slices (`indexWholeDocument`) and passed to
   * each of them. Omitted, this call prepares the text itself: right for one
   * slice, a whole-document pass repeated for every slice of many.
   */
  readonly prepared?: PreparedDocument;
  /**
   * Aborted when the job driving this run gives up on it (pg-boss stops a
   * job at its budget and retries it). The embedding in flight is cancelled
   * and no further slice starts; the stored slices are the retry's
   * checkpoint.
   */
  readonly signal?: AbortSignal;
  /**
   * Whether the caller's own records still want this document in the
   * corpus. Asked after the corpus row is claimed and before anything is
   * embedded or copied — on every slice. Answering `false` drops the claimed
   * row (and its chunks) and ends the run as `released`.
   *
   * After the claim, never before: a release always follows the commit that
   * killed the ref, so a release that ran before this run's claim is visible
   * to a check made after it, and one that runs later finds the claimed row
   * and deletes it — which the write path then notices. A check made before
   * the claim leaves a gap in which the row is re-created for a dead ref.
   */
  readonly stillWanted?: () => Promise<boolean>;
  /**
   * The corpus row an earlier slice of this run claimed. A slice that no
   * longer finds exactly that row stops as `released` instead of claiming a
   * new one: within one run the only thing that removes the row is a release,
   * and re-claiming would resurrect the dead ref. `indexWholeDocument` sets
   * it on every slice after the first.
   */
  readonly resumeDocumentId?: string;
}

export interface IndexDocumentResult {
  readonly fileId: string;
  /** The corpus row this invocation wrote to — what a continuation must find
   * again. Absent when no row was claimed. */
  readonly documentId?: string;
  /** Chunks written by THIS invocation. */
  readonly chunksWritten: number;
  /** Chunks the document has in total. */
  readonly chunksTotal: number;
  /** Chunks committed in total after this invocation (the resumed prefix
   * plus this slice) — what a progress display should show. */
  readonly chunksStored: number;
  /** True when the slice budget ran out — the caller schedules a continuation,
   * which resumes after the committed prefix. */
  readonly partial: boolean;
  /** Set when nothing was done, and why. `released`: the document's ref was
   * released while this run was in flight — the corpus holds nothing for it,
   * by design, and the run stopped without writing. */
  readonly skipped?:
    | 'unchanged'
    | 'secret-detected'
    | 'empty'
    | 'pii-blocked'
    | 'released';
  /** Present when the upload was refused, in words for the person who made it. */
  readonly refusal?: string;
}

/**
 * A document made ready to index: the secret scan, the PII policy, the
 * chunker and the content hash have run once over the whole text.
 *
 * Preparation is a pass over the ENTIRE document — the PII scan alone is
 * seconds of synchronous work on a large file — while one slice commits at
 * most `CHUNKS_PER_SLICE` chunks. A caller that drives a document through
 * several slices prepares it once and hands the result to every slice.
 */
export type PreparedDocument =
  /** Refused before anything is stored: a credential in the bytes, or the
   * organization's PII policy said `block`. */
  | {
      readonly kind: 'refused';
      readonly skipped: 'secret-detected' | 'pii-blocked';
      /** The refusal, in words for the person who uploaded the file. */
      readonly reason: string | null;
    }
  /** No text to index. */
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      /** Hash of the text the chunks were built from — the content's identity. */
      readonly contentHash: string;
      readonly chunks: readonly ContextualChunk[];
      /** Indexes of the chunks whose text repeats an earlier chunk's: stored
       * without a vector, embedded and searched once through their first
       * occurrence. */
      readonly repeats: ReadonlySet<number>;
    };

export interface PrepareDocumentArgs {
  /** The document's text, already extracted. */
  readonly text: string;
  /** The original bytes, scanned for credentials. Omitted when the caller has
   * already scanned them. */
  readonly bytes?: Uint8Array;
  /** The organization's PII policy, already parsed; absent or disabled
   * indexes the text as it is. */
  readonly piiConfig?: PiiConfig | null;
  readonly filename: string;
  /** What the chunk header announces when it should differ from `filename`
   * (see `IndexDocumentArgs.title`). */
  readonly title?: string;
}

/**
 * Prepare a document for indexing — pure, no database.
 *
 * Runs everything that looks at the whole text, in the order the write path
 * always ran it: the secret scan first (a credential must never be chunked),
 * then the organization's PII policy, then the chunker and the hash.
 */
export function prepareDocument(args: PrepareDocumentArgs): PreparedDocument {
  if (args.bytes !== undefined) {
    const scan = scanForSecrets(args.bytes);
    if (scan.rejected) {
      return {
        kind: 'refused',
        skipped: 'secret-detected',
        reason: scan.reason,
      };
    }
  }

  // The organization's own PII policy, applied before anything is chunked or
  // embedded — so a masked identifier never reaches the vectors, and a blocked
  // document never reaches the index at all.
  // A NUL cannot be stored by the corpus (Postgres `22021`); it is stripped
  // BEFORE the policy and the chunker see the text, so a stray one never
  // fails the chunk INSERT after the embedding was paid for.
  const decision = applyPiiPolicyForIndexing(
    sanitizeExtractedText(args.text),
    args.piiConfig ?? null,
  );
  if (decision.kind === 'refuse') {
    return {
      kind: 'refused',
      skipped: 'pii-blocked',
      reason: `Indexing refused by the organization's PII policy (${decision.categoryIds.join(', ')}).`,
    };
  }

  const chunks = chunkDocument(decision.text, {
    title: args.title ?? args.filename,
  });
  if (chunks.length === 0) return { kind: 'empty' };

  // Hashed AFTER the policy, not before. The hash is the content's identity:
  // skip-if-unchanged and the duplicate-clone lookup both key on it. Hashing
  // the raw text would make a policy change invisible — the same file would
  // read as unchanged and keep its old, less-masked chunks forever.
  const contentHash = computeContentHash(decision.text);

  // One vector per DISTINCT passage of the document: a chunk whose text
  // repeats an earlier chunk's (an export of one line repeated, a templated
  // report) is stored as a repeat — text kept, so the document reassembles
  // exactly; no embedding, out of both search legs. A file of 4,500 identical
  // chunks used to put 4,500 identical vectors into the shared index, where
  // they crowded out every nearer passage and were ranked 24 times over by
  // the keyword leg (2026-09-14 evaluation, h4).
  const firstOfHash = new Map<string, number>();
  const repeats = new Set<number>();
  for (const chunk of chunks) {
    const hash = computeContentHash(chunk.text);
    if (firstOfHash.has(hash)) repeats.add(chunk.index);
    else firstOfHash.set(hash, chunk.index);
  }

  return { kind: 'ready', contentHash, chunks, repeats };
}

/**
 * Index one document, committing at most one slice of chunks.
 *
 * Returns `partial: true` when chunks remain; calling again with the same
 * arguments resumes where this call stopped. A caller making several such
 * calls passes the document `prepared` once — see `indexWholeDocument`.
 */
export async function indexDocument(
  args: IndexDocumentArgs,
): Promise<IndexDocumentResult> {
  args.signal?.throwIfAborted();
  // A corpus whose BM25 index is being rebuilt (or whose rebuild failed)
  // refuses the write with a coded error — before any embedding is paid for
  // — instead of PANICking the database on the first chunk insert.
  await assertCorpusWritable(args.dbUrl, SCHEMA);
  const prepared = args.prepared ?? prepareDocument(args);
  if (prepared.kind === 'refused') {
    await markFailed(args.sql, args.orgSlug, args.fileId, prepared.reason);
    return {
      fileId: args.fileId,
      chunksWritten: 0,
      chunksTotal: 0,
      chunksStored: 0,
      partial: false,
      skipped: prepared.skipped,
      ...(prepared.reason !== null && { refusal: prepared.reason }),
    };
  }
  if (prepared.kind === 'empty') {
    return {
      fileId: args.fileId,
      chunksWritten: 0,
      chunksTotal: 0,
      chunksStored: 0,
      partial: false,
      skipped: 'empty',
    };
  }

  const { contentHash, chunks, repeats } = prepared;
  const stored = await readStoredState(args.sql, args.orgSlug, args.fileId);
  if (
    args.resumeDocumentId !== undefined &&
    stored?.id !== args.resumeDocumentId
  ) {
    // The row the previous slice wrote to is gone — released between slices.
    // Claiming again would re-create it for a ref nothing holds any more,
    // and embed the whole document over again for nobody.
    logger.info(
      `document "${args.fileId}" was released between slices; stopping`,
    );
    return released(args.fileId, chunks.length);
  }
  const duplicate = await findDuplicate(
    args.sql,
    args.orgSlug,
    contentHash,
    args.fileId,
  );
  const plan = planIngest({
    contentHash,
    totalChunks: chunks.length,
    stored: stored?.state ?? null,
    duplicateOf: duplicate,
  });

  if (plan.action === 'skip') {
    // Content is unchanged, so nothing re-embeds — but the document's scope
    // or folder can have moved since it was indexed (a project detach
    // releases it to the hub without touching a byte). Re-stamp the corpus
    // row off the current args, so `POST …/retry-indexing` HEALS a drifted
    // stamp instead of reporting success and changing nothing — the one
    // recovery path a caller has for a released-but-unfindable document.
    // `IS DISTINCT FROM` writes only when a column actually drifted.
    const skipTeamIds =
      args.teamIds && args.teamIds.length > 0 ? [...args.teamIds] : null;
    await args.sql.unsafe(
      `UPDATE ${SCHEMA}.documents SET
          team_ids = $3::text[], team_id = $4, project_id = $5,
          folder_path = $6, conversation_id = $7, updated_at = NOW()
        WHERE org_slug = $1 AND file_id = $2
          AND (team_ids IS DISTINCT FROM $3::text[]
            OR team_id IS DISTINCT FROM $4
            OR project_id IS DISTINCT FROM $5
            OR folder_path IS DISTINCT FROM $6
            OR conversation_id IS DISTINCT FROM $7)`,
      [
        args.orgSlug,
        args.fileId,
        skipTeamIds,
        skipTeamIds?.[0] ?? null,
        args.projectId ?? null,
        args.folderPath ?? null,
        args.conversationId ?? null,
      ],
    );
    logger.info(
      `document "${args.fileId}" is unchanged and fully indexed; nothing to do`,
    );
    return {
      fileId: args.fileId,
      chunksWritten: 0,
      chunksTotal: chunks.length,
      chunksStored: chunks.length,
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

  // Asked after the claim, never before — see `IndexDocumentArgs.stillWanted`
  // for why the order is the whole guarantee.
  if (args.stillWanted !== undefined && !(await args.stillWanted())) {
    await dropClaim(args.sql, args.orgSlug, documentId);
    logger.info(
      `document "${args.fileId}" is no longer referenced; dropped its claim and stored nothing`,
    );
    return released(args.fileId, chunks.length);
  }

  if (plan.action === 'clone') {
    const copied = await cloneChunks(
      args.sql,
      args.orgSlug,
      plan.sourceDocumentId,
      documentId,
    );
    if (copied === null) {
      logger.info(
        `document "${args.fileId}" was released while its chunks were being copied; stopping`,
      );
      return released(args.fileId, chunks.length);
    }
    await markCompleted(args.sql, args.orgSlug, documentId, copied);
    logger.info(
      `document "${args.fileId}" matched content already indexed for this organization; copied ${copied} chunks instead of re-embedding`,
    );
    return {
      fileId: args.fileId,
      documentId,
      chunksWritten: copied,
      chunksTotal: copied,
      chunksStored: copied,
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
    // A repeated passage (see `prepareDocument`) is stored without a vector.
    const repeated = window.map((chunk) => repeats.has(chunk.index));
    const distinct = window.filter((_chunk, position) => !repeated[position]);
    const embedded = await args.embedder.embedAll(
      distinct.map((chunk) => chunk.embedText),
      { signal: args.signal },
    );
    for (const vector of embedded) {
      assertVectorWidth(
        vector,
        args.embedder.dimensions,
        `the embedding model "${args.embedder.model.model}"`,
      );
    }
    const vectors: (readonly number[] | null)[] = [];
    let next = 0;
    for (const isRepeat of repeated) {
      vectors.push(isRepeat ? null : (embedded[next++] ?? null));
    }
    const outcome = await writeChunks({
      sql: args.sql,
      orgSlug: args.orgSlug,
      documentId,
      chunks: window,
      vectors,
    });
    if (outcome === 'released') {
      logger.info(
        `document "${args.fileId}" was released while its slice was being embedded; stopping`,
      );
      return released(args.fileId, chunks.length);
    }
  }

  if (slice.done) {
    await markCompleted(args.sql, args.orgSlug, documentId, chunks.length);
  }

  return {
    fileId: args.fileId,
    documentId,
    chunksWritten: window.length,
    chunksTotal: chunks.length,
    chunksStored: slice.to,
    partial: !slice.done,
  };
}

/** The result of a run that stopped because its document was released: the
 * corpus holds nothing for the ref, so nothing is stored and nothing remains. */
function released(fileId: string, chunksTotal: number): IndexDocumentResult {
  return {
    fileId,
    chunksWritten: 0,
    chunksTotal,
    chunksStored: 0,
    partial: false,
    skipped: 'released',
  };
}

export interface IndexWholeDocumentHooks {
  /** Called after every slice that leaves chunks to do, with that slice's
   * result — the progress (`chunksStored` of `chunksTotal`) a caller relays
   * before the next slice runs. */
  readonly onSlice?: (result: IndexDocumentResult) => void | Promise<void>;
}

/**
 * Index a whole document: prepare it once, then commit slices until none
 * remain.
 *
 * 0.4 committed one slice per scheduled invocation (the action budget) and
 * rescheduled until `partial` cleared; the 0.5 worker owns the whole job, so
 * the slices drain here, in-process. Every slice is still committed and
 * resumable — a crash resumes after the stored prefix — and the preparation
 * is paid once for the document, not once per slice. A run whose job gave up
 * (`signal`) stops before its next slice; its retry resumes from there.
 */
export async function indexWholeDocument(
  args: Omit<IndexDocumentArgs, 'prepared'>,
  hooks: IndexWholeDocumentHooks = {},
): Promise<IndexDocumentResult> {
  args.signal?.throwIfAborted();
  // Refused before the preparation is paid for, as a single slice would be.
  await assertCorpusWritable(args.dbUrl, SCHEMA);
  const prepared = prepareDocument(args);
  let result = await indexDocument({ ...args, prepared });
  while (result.partial) {
    if (result.chunksWritten === 0) {
      throw new Error(
        `Indexing made no progress at ${result.chunksStored}/${result.chunksTotal} chunks`,
      );
    }
    await hooks.onSlice?.(result);
    args.signal?.throwIfAborted();
    // Every later slice must find the row the first one claimed — a slice
    // that does not has been released underneath and stops (see
    // `IndexDocumentArgs.resumeDocumentId`).
    result = await indexDocument({
      ...args,
      prepared,
      ...(result.documentId !== undefined
        ? { resumeDocumentId: result.documentId }
        : {}),
    });
  }
  return result;
}

/** What the corpus already holds for this document reference, and under
 * which row. */
async function readStoredState(
  sql: Sql,
  orgSlug: string,
  fileId: string,
): Promise<{
  readonly id: string;
  readonly state: import('../../../lib/knowledge/ingest-plan').StoredDocumentState;
} | null> {
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
    id: row.id,
    state: {
      contentHash: row.content_hash,
      status: asStatus(row.status),
      storedChunks: row.stored,
    },
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

/**
 * Hold the claimed document row for the rest of the transaction, or learn that
 * it is gone. KEY SHARE is the lock an inserted chunk's foreign key takes on
 * its parent anyway; taking it first, explicitly, turns the two outcomes of a
 * concurrent release into two clean ones: a release that already ran leaves
 * no row, and the write stops; one that arrives now waits for this commit
 * and then cascades the chunks away — a consistent end state, never the FK
 * violation the bare insert raised.
 */
async function lockClaimedRow(
  tx: TransactionSql,
  orgSlug: string,
  documentId: string,
): Promise<boolean> {
  const rows = await tx.unsafe<{ id: string }[]>(
    `SELECT id FROM ${SCHEMA}.documents
     WHERE id = $1 AND org_slug = $2
     FOR KEY SHARE`,
    [documentId, orgSlug],
  );
  return rows.length > 0;
}

/**
 * Take back a claim on a document nothing references any more: the row and
 * whatever chunks it has, in one transaction. Chunks explicitly, not by
 * cascade alone — the same shape as the release seam's delete, so a corpus
 * without the constraint is left just as clean.
 */
async function dropClaim(
  sql: Sql,
  orgSlug: string,
  documentId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe(
      `DELETE FROM ${SCHEMA}.chunks WHERE document_id = $1 AND org_slug = $2`,
      [documentId, orgSlug],
    );
    await tx.unsafe(
      `DELETE FROM ${SCHEMA}.documents WHERE id = $1 AND org_slug = $2`,
      [documentId, orgSlug],
    );
  });
}

/** Commit one slice of chunks. A `null` vector marks a repeated passage:
 * stored for reassembly, embedded and searched once through its first
 * occurrence. `released` when the document row is no longer there to hold
 * them — nothing is written. */
async function writeChunks(args: {
  sql: Sql;
  orgSlug: string;
  documentId: string;
  chunks: readonly ContextualChunk[];
  vectors: readonly (readonly number[] | null)[];
}): Promise<'written' | 'released'> {
  return args.sql.begin(async (tx) => {
    if (!(await lockClaimedRow(tx, args.orgSlug, args.documentId))) {
      return 'released';
    }
    for (const [position, chunk] of args.chunks.entries()) {
      const vector = args.vectors[position] ?? null;
      await tx.unsafe(
        `INSERT INTO ${SCHEMA}.chunks
            (document_id, org_slug, chunk_index, chunk_content, content_hash,
             embedding, context_header, core_content, prefix_overlap, suffix_overlap,
             passage_repeat)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8, $9, $10, $11)
         ON CONFLICT (document_id, chunk_index) DO UPDATE SET
             chunk_content = EXCLUDED.chunk_content,
             content_hash = EXCLUDED.content_hash,
             embedding = EXCLUDED.embedding,
             context_header = EXCLUDED.context_header,
             core_content = EXCLUDED.core_content,
             prefix_overlap = EXCLUDED.prefix_overlap,
             suffix_overlap = EXCLUDED.suffix_overlap,
             passage_repeat = EXCLUDED.passage_repeat`,
        [
          args.documentId,
          args.orgSlug,
          chunk.index,
          // The stored text carries the contextual header, so a passage
          // retrieved on its own still says where it came from — and so the
          // keyword index matches on it too.
          chunk.embedText,
          computeContentHash(chunk.text),
          vector === null ? null : JSON.stringify(vector),
          chunk.header,
          chunk.core,
          chunk.prefixOverlap,
          chunk.suffixOverlap,
          vector === null,
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
    return 'written';
  });
}

/** Copy an identical document's chunks and embeddings. `null` when the
 * target row is no longer there to receive them. */
async function cloneChunks(
  sql: Sql,
  orgSlug: string,
  sourceDocumentId: string,
  targetDocumentId: string,
): Promise<number | null> {
  return sql.begin(async (tx) => {
    if (!(await lockClaimedRow(tx, orgSlug, targetDocumentId))) return null;
    const rows = await tx.unsafe<{ count: number }[]>(
      `WITH copied AS (
         INSERT INTO ${SCHEMA}.chunks
             (document_id, org_slug, chunk_index, chunk_content, content_hash,
              embedding, context_header, core_content, prefix_overlap, suffix_overlap,
              passage_repeat)
         SELECT $1, $2, chunk_index, chunk_content, content_hash, embedding,
                context_header, core_content, prefix_overlap, suffix_overlap,
                passage_repeat
         FROM ${SCHEMA}.chunks
         WHERE document_id = $3 AND org_slug = $2
         ON CONFLICT (document_id, chunk_index) DO NOTHING
         RETURNING 1
       )
       SELECT count(*)::int AS count FROM copied`,
      [targetDocumentId, orgSlug, sourceDocumentId],
    );
    return rows[0]?.count ?? 0;
  });
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
