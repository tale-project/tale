import type { ToolCtx } from '@convex-dev/agent';

import type { AgentIndexedDocumentListResult } from '../../../documents/list_indexed_documents_for_agent';
import type { AgentKnowledgeCtx } from '../rag_search_tool';

import { internal } from '../../../_generated/api';

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

  return ctx.runQuery(internal.documents.internal_queries.listIndexedForAgent, {
    organizationId,
    agentTeamId: extended.agentTeamId,
    includeTeamKnowledge: extended.includeTeamKnowledge,
    includeOrgKnowledge: extended.includeOrgKnowledge,
    knowledgeFileIds: extended.knowledgeFileIds,
    limit: args.limit,
    cursor: args.cursor,
  });
}
