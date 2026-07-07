import type { ToolCtx } from '@convex-dev/agent';

import { internal } from '../../../_generated/api';
import type { AgentIndexedDocumentListResult } from '../../../documents/list_indexed_documents_for_agent';
import type { AgentKnowledgeCtx } from '../rag_search_tool';

export async function listIndexedDocuments(
  ctx: ToolCtx,
  args: { limit?: number; cursor?: string },
): Promise<AgentIndexedDocumentListResult> {
  const { organizationId } = ctx;

  if (!organizationId) {
    throw new Error(
      'rag_search list_indexed requires organizationId in ToolCtx.',
    );
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ToolCtx from @convex-dev/agent lacks our agent knowledge properties injected at runtime
  const extended = ctx as AgentKnowledgeCtx;

  try {
    return await ctx.runQuery(
      internal.documents.internal_queries.listIndexedForAgent,
      {
        organizationId,
        agentTeamId: extended.agentTeamId,
        agentTeamIds: extended.agentTeamIds,
        includeTeamKnowledge: extended.includeTeamKnowledge,
        includeOrgKnowledge: extended.includeOrgKnowledge,
        knowledgeFileIds: extended.knowledgeFileIds,
        agentProjectIds: extended.agentProjectIds,
        limit: args.limit,
        cursor: args.cursor,
      },
    );
  } catch (err) {
    // Defense-in-depth: a very large knowledge corpus can push this past the
    // Convex transaction read cap. Degrade to an empty listing rather than
    // throwing an opaque tool error to the agent.
    console.warn(
      '[rag_search list_indexed] listIndexedForAgent failed; returning empty listing',
      err instanceof Error ? err.message : err,
    );
    return { documents: [], totalCount: null, hasMore: false, cursor: null };
  }
}
