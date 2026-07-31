'use node';

/**
 * Corpus-side ingestion state, read for reconciliation.
 *
 * The RAG watchdog compares a `fileMetadata` row it suspects is dead against
 * what the organization's corpus actually says about the document: a corpus
 * row that reached `completed` means only the status write-back was lost (the
 * row is adopted), a fresh `processing` row is a live sliced run (left
 * alone), and a missing row means ingestion never landed. Routed through the
 * per-org pool chokepoint like every other corpus read.
 */

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { getKnowledgePoolForOrg, PRIVATE_KNOWLEDGE_SCHEMA } from './pool';

export interface CorpusDocumentStatus {
  status: string;
  error: string | null;
  ocr_applied: boolean | null;
  updated_at: string | null;
}

export const getStatuses = internalAction({
  args: {
    orgSlug: v.string(),
    fileIds: v.array(v.string()),
  },
  returns: v.record(
    v.string(),
    v.union(
      v.object({
        status: v.string(),
        error: v.union(v.string(), v.null()),
        ocr_applied: v.union(v.boolean(), v.null()),
        updated_at: v.union(v.string(), v.null()),
      }),
      v.null(),
    ),
  ),
  handler: async (
    _ctx,
    args,
  ): Promise<Record<string, CorpusDocumentStatus | null>> => {
    const statuses: Record<string, CorpusDocumentStatus | null> = {};
    for (const fileId of args.fileIds) statuses[fileId] = null;
    if (args.fileIds.length === 0) return statuses;

    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    const rows = await sql.unsafe<
      {
        file_id: string;
        status: string;
        error: string | null;
        ocr_applied: boolean | null;
        updated_at: string | null;
      }[]
    >(
      `SELECT file_id, status, error, ocr_applied, updated_at::text
         FROM ${PRIVATE_KNOWLEDGE_SCHEMA}.documents
        WHERE org_slug = $1 AND file_id = ANY($2)`,
      [args.orgSlug, args.fileIds],
    );
    for (const row of rows) {
      statuses[row.file_id] = {
        status: row.status,
        error: row.error,
        ocr_applied: row.ocr_applied,
        updated_at: row.updated_at,
      };
    }
    return statuses;
  },
});
