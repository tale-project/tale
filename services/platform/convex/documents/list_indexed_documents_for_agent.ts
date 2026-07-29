import type { QueryCtx } from '../_generated/server';

// The real implementation (retired)
// backed the `rag_search` agent tool's `list_indexed` operation, paginating
// `fileMetadata` rows with `ragStatus: 'completed'`. Both the RAG pipeline and
// the agent-tools plane that called this (`convex/agent_tools/`) are
// retired, so `documents/internal_queries.ts`'s `listIndexedForAgent` query
// currently has no live caller either — this always returns an empty,
// exhausted page so the query keeps compiling and behaves safely if anything
// calls it again before the rewrite restores real pagination.

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

/**
 * No-op — always returns an empty, exhausted page. See
 * file header.
 */
export async function listIndexedDocumentsForAgent(
  _ctx: QueryCtx,
  args: {
    organizationId: string;
    agentTeamId?: string;
    agentTeamIds?: string[];
    includeTeamKnowledge?: boolean;
    includeOrgKnowledge?: boolean;
    knowledgeFileIds?: string[];
    agentProjectIds?: string[];
    limit?: number;
    cursor?: string;
  },
): Promise<AgentIndexedDocumentListResult> {
  console.debug(
    `[list_indexed_documents_for_agent] RAG indexing is offline while the platform AI backend is rewritten; returning an empty list for org ${args.organizationId}`,
  );
  return { documents: [], totalCount: 0, hasMore: false, cursor: null };
}
