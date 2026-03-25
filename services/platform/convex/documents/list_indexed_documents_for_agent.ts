/**
 * List indexed documents for agent tool
 *
 * Core query logic for the rag_search tool's list_indexed operation.
 * Returns documents that have been successfully indexed in the RAG service,
 * scoped to the agent's knowledge access configuration.
 *
 * Uses Convex native .paginate() for cursor-based pagination, with
 * in-memory agent scoping applied after each page fetch.
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

  const matches: Array<Doc<'documents'> & { fileId: Id<'_storage'> }> = [];
  let cursor: string | null = args.cursor ?? null;
  let isDone = false;
  let pages = 0;

  // Fetch pages until we have enough matches or exhaust the index.
  // Each .paginate() call returns a database-level page; we filter in memory
  // for agent scoping, so we may need multiple pages to fill `limit`.
  while (matches.length < limit + 1 && !isDone && pages < MAX_PAGES) {
    pages++;

    const result = await ctx.db
      .query('documents')
      .withIndex('by_organizationId_and_indexed', (q) =>
        q.eq('organizationId', args.organizationId).eq('indexed', true),
      )
      .order('desc')
      .paginate({ cursor: cursor ?? null, numItems: limit * 2 });

    for (const doc of result.page) {
      if (!doc.fileId) continue;

      const fileId = String(doc.fileId);

      if (knowledgeFileIdSet.has(fileId)) {
        matches.push(doc as Doc<'documents'> & { fileId: Id<'_storage'> });
        continue;
      }

      if (needsTeamDocs && doc.teamId === args.agentTeamId) {
        matches.push(doc as Doc<'documents'> & { fileId: Id<'_storage'> });
        continue;
      }

      if (needsOrgDocs && !doc.teamId) {
        matches.push(doc as Doc<'documents'> & { fileId: Id<'_storage'> });
      }
    }

    isDone = result.isDone;
    cursor = result.continueCursor;
  }

  const hasMore = matches.length > limit || !isDone;
  const page = matches.slice(0, limit);

  const documents: AgentIndexedDocumentItem[] = page.map((doc) => ({
    fileId: String(doc.fileId),
    name: doc.title ?? 'Untitled',
    sourceModifiedAt: doc.sourceModifiedAt ?? null,
  }));

  // Return the Convex cursor for the next page, or null if exhausted.
  // When matches > limit, we still have unprocessed matches from the current
  // database page — return the current cursor so the next call re-fetches
  // from the same position.
  const nextCursor = hasMore ? cursor : null;

  return {
    documents,
    totalCount: null,
    hasMore,
    cursor: nextCursor,
  };
}
