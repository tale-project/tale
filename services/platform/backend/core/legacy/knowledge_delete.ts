'use node';

/**
 * Corpus row removal for the ref-release seam.
 *
 * `domains/knowledge/release.ts` is the only caller: `releaseRefs` drives
 * {@link deleteKnowledgeDocumentsBatch} for purge cascades (retention, user
 * delete, folder cascade, erasure, sync prune) and the rotation job, and
 * `reconcileCorpusForOrg` walks the corpus with
 * {@link listKnowledgeDocumentRefs} to release historically stranded rows.
 *
 * Both reach the corpus through `getKnowledgePoolForOrg` — the single
 * tenant-routing entry point the indexer and every search leg use — so a
 * purge deletes from the SAME database the index was written to. A second
 * resolver here once honoured a `RAG_DATABASE_URL` alias the live pool never
 * read; in the shipped container env that pointed the purge at an empty twin
 * of the corpus and every erasure reported success while the chunks stayed
 * behind.
 *
 * The SQL ports the retired `RagService.deleteDocument` verbatim, including
 * its idempotent-on-missing semantics: a ref with no rows is a no-op success,
 * so retention re-runs and cascade purges stay safe to repeat.
 *
 * `'use node'` is the core/ marker for a module that does Node-side I/O —
 * here the postgres pool — as opposed to the pure modules that leave it out.
 */

import { MESSAGE_REF_LIKE_PATTERN } from '../../../lib/knowledge/message-ref';
import {
  getKnowledgePoolForOrg,
  PRIVATE_KNOWLEDGE_SCHEMA,
} from '../knowledge/pool';

export interface DeleteDocumentsBatchArgs {
  orgSlug: string;
  fileIds: string[];
}

export interface DeleteDocumentsBatchResult {
  success: boolean;
  deleted_count: number;
  failed_file_ids: string[];
}

/**
 * Delete MANY corpus documents (and their chunks) by file ref, scoped to
 * `orgSlug`. All-or-nothing per call: the two deletes run in one transaction,
 * so a thrown connection error means NO ref was acknowledged and the caller
 * retries the whole batch safely.
 */
export async function deleteKnowledgeDocumentsBatch(
  args: DeleteDocumentsBatchArgs,
): Promise<DeleteDocumentsBatchResult> {
  if (args.fileIds.length === 0) {
    return { success: true, deleted_count: 0, failed_file_ids: [] };
  }
  const sql = await getKnowledgePoolForOrg(args.orgSlug);
  const rows = await sql.unsafe<{ id: string }[]>(
    `SELECT id FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents WHERE org_slug = $1 AND file_id = ANY($2)`,
    [args.orgSlug, args.fileIds],
  );
  if (rows.length === 0) {
    return { success: true, deleted_count: 0, failed_file_ids: [] };
  }
  const idsToDelete = rows.map((row) => row.id);
  await sql.begin(async (tx) => {
    await tx.unsafe(
      `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.chunks WHERE org_slug = $1 AND document_id = ANY($2)`,
      [args.orgSlug, idsToDelete],
    );
    await tx.unsafe(
      `DELETE FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents WHERE org_slug = $1 AND id = ANY($2)`,
      [args.orgSlug, idsToDelete],
    );
  });
  return {
    success: true,
    deleted_count: idsToDelete.length,
    failed_file_ids: [],
  };
}

/**
 * Enumerate one page of an org's corpus documents by file ref (keyset on
 * `file_id`, after `afterFileId` and before `beforeFileId` when given) — the
 * reconcile sweep's walk.
 *
 * One vocabulary per walk: `blobs` (every file ref) or `messages` (the email
 * bodies' `msg:` refs). They are walked apart because each walk is bounded
 * and restarts at its keyset head, and `msg:` sorts ahead of `s3:` — sharing
 * one walk, a large inbox would fill every run's budget and push every blob
 * ref out of reconcile's reach.
 */
export async function listKnowledgeDocumentRefs(args: {
  orgSlug: string;
  refs: 'blobs' | 'messages';
  afterFileId: string | null;
  beforeFileId?: string | null;
  limit: number;
}): Promise<string[]> {
  const sql = await getKnowledgePoolForOrg(args.orgSlug);
  const rows = await sql.unsafe<{ fileId: string }[]>(
    `SELECT DISTINCT file_id AS "fileId"
       FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
      WHERE org_slug = $1 AND ($2::text IS NULL OR file_id > $2)
        AND ($4::text IS NULL OR file_id < $4)
        AND (file_id LIKE $5) = $6::boolean
      ORDER BY file_id ASC
      LIMIT $3`,
    [
      args.orgSlug,
      args.afterFileId,
      args.limit,
      args.beforeFileId ?? null,
      MESSAGE_REF_LIKE_PATTERN,
      args.refs === 'messages',
    ],
  );
  return rows.map((row) => row.fileId);
}
