/**
 * List indexed documents for agent tool
 *
 * Core query logic for the rag_search tool's list_indexed operation.
 * Returns documents that have been successfully indexed in the RAG service,
 * scoped to the agent's knowledge access configuration.
 *
 * Uses Convex native .paginate() for cursor-based pagination, with
 * in-memory agent scoping applied after each page fetch.
 *
 * Pagination: uses a composite cursor that encodes both the Convex DB cursor
 * and a skip count. When a single DB page yields more matches than `limit`,
 * the surplus is served on the next call by re-fetching the same DB page
 * and skipping already-returned matches.
 */

import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const MAX_PAGES = 20;

export interface AgentIndexedDocumentItem {
  fileId: string;
  name: string;
  sourceModifiedAt: number | null;
}

export interface AgentIndexedDocumentListResult {
  documents: AgentIndexedDocumentItem[];
  totalCount: number | null;
  hasMore: boolean;
  cursor: string | null;
}

function hasFileId(
  doc: Doc<'documents'>,
): doc is Doc<'documents'> & { fileId: Id<'_storage'> } {
  return !!doc.fileId;
}

interface CompositeState {
  dbCursor: string | null;
  skip: number;
}

function decodeCursor(raw: string | undefined): CompositeState {
  if (!raw) return { dbCursor: null, skip: 0 };
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      return { dbCursor: parsed.c ?? null, skip: parsed.s ?? 0 };
    } catch (e) {
      console.warn(
        '[decodeCursor] Failed to parse cursor as JSON, treating as raw DB cursor:',
        e,
      );
    }
  }
  return { dbCursor: raw, skip: 0 };
}

function encodeCursor(dbCursor: string | null, skip: number): string {
  if (skip === 0 && dbCursor) return dbCursor;
  return JSON.stringify({ c: dbCursor, s: skip });
}

export async function listIndexedDocumentsForAgent(
  ctx: QueryCtx,
  args: {
    organizationId: string;
    agentTeamId?: string;
    includeTeamKnowledge?: boolean;
    includeOrgKnowledge?: boolean;
    knowledgeFileIds?: string[];
    limit?: number;
    cursor?: string;
  },
): Promise<AgentIndexedDocumentListResult> {
  const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const knowledgeFileIdSet = new Set(args.knowledgeFileIds ?? []);
  const needsTeamDocs =
    args.includeTeamKnowledge !== false && !!args.agentTeamId;
  const needsOrgDocs = args.includeOrgKnowledge === true;

  const { dbCursor: startDbCursor, skip: initialSkip } = decodeCursor(
    args.cursor,
  );

  const matches: Array<Doc<'documents'> & { fileId: Id<'_storage'> }> = [];
  let dbCursor: string | null = startDbCursor;
  let isDone = false;
  let pages = 0;
  let skipRemaining = initialSkip;

  // Track how many matches we've seen on the current page (pre-skip).
  // This lets us compute the correct skip count for the cursor.
  let prevDbCursor: string | null = startDbCursor;
  let matchesSeenOnLastPage = 0;

  while (matches.length <= limit && !isDone && pages < MAX_PAGES) {
    pages++;
    prevDbCursor = dbCursor;
    matchesSeenOnLastPage = 0;

    const result = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_indexed', (q) =>
        q.eq('organizationId', args.organizationId).eq('indexed', true),
      )
      .order('desc')
      .paginate({ cursor: dbCursor ?? null, numItems: limit * 2 });

    for (const doc of result.page) {
      if (!hasFileId(doc)) continue;

      const fileId = String(doc.fileId);
      const isMatch =
        knowledgeFileIdSet.has(fileId) ||
        (needsTeamDocs && doc.teamId === args.agentTeamId) ||
        (needsOrgDocs && !doc.teamId);

      if (!isMatch) continue;

      matchesSeenOnLastPage++;

      if (skipRemaining > 0) {
        skipRemaining--;
        continue;
      }

      matches.push(doc);
    }

    isDone = result.isDone;
    dbCursor = result.continueCursor;
  }

  const hasMore = matches.length > limit || !isDone;
  const page = matches.slice(0, limit);

  const documents: AgentIndexedDocumentItem[] = page.map((doc) => ({
    fileId: String(doc.fileId),
    name: doc.title ?? 'Untitled',
    sourceModifiedAt: doc.sourceModifiedAt ?? null,
  }));

  let nextCursor: string | null = null;
  if (hasMore) {
    const overflow = matches.length - limit;
    if (overflow > 0) {
      // We collected more matches than limit from the last DB page.
      // Re-fetch the same page on the next call, skipping the matches
      // we already returned. skip = (matches returned from this page).
      const returnedFromLastPage = matchesSeenOnLastPage - overflow;
      const skipForNextCall =
        (prevDbCursor === startDbCursor ? initialSkip : 0) +
        returnedFromLastPage;
      nextCursor = encodeCursor(prevDbCursor, skipForNextCall);
    } else {
      // We consumed complete pages — advance to the next DB page.
      nextCursor = dbCursor;
    }
  }

  return {
    documents,
    totalCount: null,
    hasMore,
    cursor: nextCursor,
  };
}
