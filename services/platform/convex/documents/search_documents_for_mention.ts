/**
 * Backend search for the chat composer's `@` knowledge-base mention picker.
 *
 * Title search runs through the shared entity-search seam
 * (`runEntitySearch` + `documentsSearchStrategy`), then each candidate is
 * post-filtered to documents the user can actually pin to a turn:
 *  - team-accessible (same rule as `listDocumentsPaginated`)
 *  - backed by a `_storage` blob (`fileId` present)
 *  - RAG-indexed (`fileMetadata.ragStatus === 'completed'`) — the pinned-turn
 *    retrieval scopes the RAG query to these fileIds, so a non-indexed doc
 *    would silently contribute nothing. Indexed-only keeps the picker honest.
 *
 * The scan is bounded: at most `MAX_SCAN_SLICES` paginate slices of
 * `SCAN_SLICE_SIZE` rows, collecting up to `MENTION_RESULT_LIMIT` results.
 */

import type { PaginationResult } from 'convex/server';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { documentsSearchStrategy, runEntitySearch } from '../lib/search';
import { hasKnowledgeHubDocumentAccess } from './access';

export const MENTION_RESULT_LIMIT = 10;
const MAX_SCAN_SLICES = 5;
const SCAN_SLICE_SIZE = 50;

export interface MentionDocumentResult {
  documentId: Id<'documents'>;
  fileId: Id<'_storage'>;
  /** Display title — document title, falling back to the blob's file name. */
  title: string;
  fileType: string;
  fileSize: number;
  extension?: string;
  folderPath?: string;
}

interface SearchDocumentsForMentionArgs {
  organizationId: string;
  /** Raw query the user typed after `@`. Empty shows the newest indexed docs. */
  term: string;
  userTeamIds: string[];
}

async function toMentionResult(
  ctx: QueryCtx,
  doc: Doc<'documents'>,
): Promise<MentionDocumentResult | null> {
  const fileId = doc.fileId;
  if (!fileId) return null;
  const fm = await ctx.db
    .query('fileMetadata')
    .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
    .first();
  if (!fm || fm.ragStatus !== 'completed') return null;
  return {
    documentId: doc._id,
    fileId,
    title: doc.title?.trim() || fm.fileName,
    fileType: doc.mimeType ?? fm.contentType,
    fileSize: fm.size,
    extension: doc.extension,
    folderPath: doc.folderPath,
  };
}

export async function searchDocumentsForMention(
  ctx: QueryCtx,
  args: SearchDocumentsForMentionArgs,
): Promise<MentionDocumentResult[]> {
  const teamSet = new Set(args.userTeamIds);
  const results: MentionDocumentResult[] = [];

  let cursor: string | null = null;
  for (let slice = 0; slice < MAX_SCAN_SLICES; slice++) {
    // Explicit annotation: `cursor` feeds the call whose result feeds
    // `cursor`, which otherwise trips TS's circular-inference guard.
    const page: PaginationResult<Doc<'documents'>> = await runEntitySearch(
      ctx,
      documentsSearchStrategy,
      {
        organizationId: args.organizationId,
        term: args.term,
        paginationOpts: { cursor, numItems: SCAN_SLICE_SIZE },
        accessFilter: (doc) =>
          !!doc.fileId && hasKnowledgeHubDocumentAccess(doc, teamSet),
      },
    );

    for (const doc of page.page) {
      if (results.length >= MENTION_RESULT_LIMIT) break;
      const result = await toMentionResult(ctx, doc);
      if (result) results.push(result);
    }

    if (results.length >= MENTION_RESULT_LIMIT || page.isDone) break;
    cursor = page.continueCursor;
  }

  return results;
}
