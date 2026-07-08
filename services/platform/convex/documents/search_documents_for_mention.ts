/**
 * Backend search for the chat composer's `@` knowledge-base mention picker.
 *
 * Two scopes feed it:
 *  - the current thread's PROJECT files, when the composer sits in a project
 *    thread (`projectId` — access to the project itself is verified by the
 *    query wrapper). A bounded index scan + in-memory title match, ranked
 *    first: in a project thread they are the likelier target (mirrors
 *    `folders/search_folders_for_mention.ts`).
 *  - Knowledge Hub documents: title search through the shared entity-search
 *    seam (`runEntitySearch` + `documentsSearchStrategy`).
 *
 * Every candidate is post-filtered to documents the user can actually pin
 * to a turn:
 *  - scope-accessible (hub: team rules, same as `listDocumentsPaginated`;
 *    project: membership already established by the wrapper — and
 *    `resolveReferencedFiles` re-checks per document at send time)
 *  - backed by a `_storage` blob (`fileId` present)
 *  - RAG-indexed (`fileMetadata.ragStatus === 'completed'`) — the pinned-turn
 *    retrieval scopes the RAG query to these fileIds, so a non-indexed doc
 *    would silently contribute nothing. Indexed-only keeps the picker honest.
 *
 * The hub scan is bounded: at most `MAX_SCAN_SLICES` paginate slices of
 * `SCAN_SLICE_SIZE` rows, collecting up to `MENTION_RESULT_LIMIT` results.
 */

import type { PaginationResult } from 'convex/server';

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { documentsSearchStrategy, runEntitySearch } from '../lib/search';
import { isActiveDocument } from './_helpers';
import { hasKnowledgeHubDocumentAccess } from './access';

export const MENTION_RESULT_LIMIT = 10;
const MAX_SCAN_SLICES = 5;
const SCAN_SLICE_SIZE = 50;
/** Project-file scan ceiling — projects hold at most a few hundred files. */
const MAX_PROJECT_SCAN = 1000;

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
  /** Include this project's files (composer is in one of its threads). */
  projectId?: Id<'projects'>;
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

/** Project files matching the term, prefix matches first, name-sorted. */
async function collectProjectMatches(
  ctx: QueryCtx,
  organizationId: string,
  projectId: Id<'projects'>,
  term: string,
): Promise<Doc<'documents'>[]> {
  const scanned = await ctx.db
    .query('documents')
    .withIndex('by_organizationId_and_projectId', (q) =>
      q.eq('organizationId', organizationId).eq('projectId', projectId),
    )
    .take(MAX_PROJECT_SCAN);
  const needle = term.trim().toLowerCase();
  const titleOf = (doc: Doc<'documents'>) => (doc.title ?? '').toLowerCase();
  return scanned
    .filter(
      (doc) =>
        isActiveDocument(doc) && (!needle || titleOf(doc).includes(needle)),
    )
    .sort((a, b) => {
      if (needle) {
        const aPrefix = titleOf(a).startsWith(needle) ? 0 : 1;
        const bPrefix = titleOf(b).startsWith(needle) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      }
      return titleOf(a).localeCompare(titleOf(b));
    });
}

export async function searchDocumentsForMention(
  ctx: QueryCtx,
  args: SearchDocumentsForMentionArgs,
): Promise<MentionDocumentResult[]> {
  const teamSet = new Set(args.userTeamIds);
  const results: MentionDocumentResult[] = [];

  // Project files first: in a project thread they are the likelier target,
  // and the hub scan below can never contain them (hub access excludes
  // project-scoped documents), so the two scopes never duplicate.
  if (args.projectId) {
    const projectDocs = await collectProjectMatches(
      ctx,
      args.organizationId,
      args.projectId,
      args.term,
    );
    for (const doc of projectDocs) {
      if (results.length >= MENTION_RESULT_LIMIT) break;
      const result = await toMentionResult(ctx, doc);
      if (result) results.push(result);
    }
  }

  let cursor: string | null = null;
  for (let slice = 0; slice < MAX_SCAN_SLICES; slice++) {
    if (results.length >= MENTION_RESULT_LIMIT) break;
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
