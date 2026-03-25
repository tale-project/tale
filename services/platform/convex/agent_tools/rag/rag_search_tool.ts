/**
 * Convex Tool: RAG Search
 *
 * Knowledge base operations:
 * - operation = 'search': Search for relevant document chunks (hybrid BM25 + vector)
 * - operation = 'list_indexed': List documents that have been indexed in the knowledge base
 *
 * File ID resolution priority (search operation):
 * 1. Explicit fileIds arg → use directly (workflow / scoped searches)
 * 2. Agent knowledge config on ToolCtx → resolve via getAgentScopedFileIds
 *
 * All agents are custom agents; the agent's knowledge config is the sole
 * authorization boundary for RAG file access.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { AgentIndexedDocumentListResult } from '../../documents/list_indexed_documents_for_agent';
import type { ToolDefinition } from '../types';

import { fetchJson } from '../../../lib/utils/type-cast-helpers';
import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { getRagConfig } from '../../lib/helpers/rag_config';
import {
  formatSearchResults,
  type SearchResponse,
} from './format_search_results';
import { listIndexedDocuments } from './helpers/list_indexed_documents';

// ToolCtx from @convex-dev/agent does not include our custom agent knowledge
// properties — these are set by our agent configuration and injected at runtime.
export interface AgentKnowledgeCtx extends ToolCtx {
  agentTeamId?: string;
  includeTeamKnowledge?: boolean;
  includeOrgKnowledge?: boolean;
  knowledgeFileIds?: string[];
}

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const DEFAULT_TOP_K = 10;
const DEFAULT_SIMILARITY_THRESHOLD = 0.3;

export async function resolveFileIds(
  ctx: ToolCtx,
  explicitFileIds?: string[],
): Promise<string[]> {
  if (explicitFileIds && explicitFileIds.length > 0) {
    debugLog('tool:rag_search using explicit fileIds', {
      count: explicitFileIds.length,
    });
    return explicitFileIds;
  }

  const { organizationId } = ctx;
  if (!organizationId) {
    throw new Error('rag_search requires organizationId in ToolCtx.');
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ToolCtx from @convex-dev/agent lacks our custom agent knowledge properties injected at runtime
  const extended = ctx as AgentKnowledgeCtx;

  debugLog('tool:rag_search using agent-scoped file resolution', {
    agentTeamId: extended.agentTeamId,
    includeOrgKnowledge: extended.includeOrgKnowledge,
    knowledgeFileIds: extended.knowledgeFileIds?.length,
  });

  return ctx.runQuery(
    internal.documents.internal_queries.getAgentScopedFileIds,
    {
      organizationId,
      agentTeamId: extended.agentTeamId,
      includeTeamKnowledge: extended.includeTeamKnowledge,
      includeOrgKnowledge: extended.includeOrgKnowledge,
      knowledgeFileIds: extended.knowledgeFileIds,
    },
  );
}

const ragToolArgs = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('search'),
    query: z.string().describe('Query text to search the knowledge base for'),
    fileIds: z
      .array(z.string())
      .optional()
      .describe(
        'Specific file IDs to search within. When provided, only these files are searched (skips automatic file resolution). Use this when you know exactly which files to search.',
      ),
    topK: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe('Maximum number of results to return (1-50). Defaults to 10.'),
  }),
  z.object({
    operation: z.literal('list_indexed'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Max results to return (1-500). Default: 50.'),
    cursor: z
      .string()
      .optional()
      .describe(
        'Pagination cursor from previous response. Pass the exact cursor value returned — do not fabricate.',
      ),
  }),
]);

export const ragSearchTool = {
  name: 'rag_search' as const,
  tool: createTool({
    description: `Knowledge base tool for searching content and listing indexed documents.

OPERATIONS:
• 'search': Search the knowledge base for relevant document excerpts using hybrid search (BM25 + vector similarity). Returns numbered excerpts with relevance scores.
• 'list_indexed': List documents that have been indexed in the knowledge base. Returns file names, file IDs, and modification dates. Use this to see what's available before searching.

WHEN TO USE 'search':
• Knowledge base lookups: policies, procedures, documentation
• Questions about stored documents and content
• Finding information when you don't know exact field values

WHEN TO USE 'list_indexed':
• See which files are available for RAG search
• Get file IDs for use with the search operation's fileIds parameter
• Check when files were last modified

WHEN NOT TO USE:
• "How many customers?" → Use customer_read with operation='list'
• "List all products" → Use product_read with operation='list'
• "Show customers with status=churned" → Use customer_read with filtering
• For counting/listing/filtering structured data, use database tools instead
• Browsing all documents (not just indexed) → Use document_find instead

RESPONSE (list_indexed):
• documents: Array of {fileId, name, sourceModifiedAt}
• totalCount: Total matching documents (null if scan limit reached)
• hasMore: Whether more results are available
• cursor: Opaque pagination cursor. Pass the exact value to the next call to fetch the next page. Do not fabricate values.`,
    inputSchema: ragToolArgs,
    execute: async (
      ctx: ToolCtx,
      args,
    ): Promise<string | AgentIndexedDocumentListResult> => {
      if (args.operation === 'list_indexed') {
        return listIndexedDocuments(ctx, {
          limit: args.limit,
          cursor: args.cursor,
        });
      }

      // operation === 'search'
      debugLog('tool:rag_search start', {
        query: args.query,
        explicitFileIds: args.fileIds?.length,
      });

      const fileIds = await resolveFileIds(ctx, args.fileIds);

      if (fileIds.length === 0) {
        return 'No documents available in the knowledge base. Upload documents first.';
      }

      const ragServiceUrl = getRagConfig().serviceUrl;
      const url = `${ragServiceUrl}/api/v1/search`;

      const payload = {
        query: args.query,
        file_ids: fileIds,
        top_k: args.topK ?? DEFAULT_TOP_K,
        similarity_threshold: DEFAULT_SIMILARITY_THRESHOLD,
        include_metadata: true,
      };

      debugLog('tool:rag_search requesting search', {
        fileCount: fileIds.length,
        fileIds,
      });

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`RAG service error: ${response.status} ${errorText}`);
        }

        const result = await fetchJson<SearchResponse>(response);

        const formatted =
          formatSearchResults(result.results) ??
          'No relevant results found in the knowledge base.';

        debugLog('tool:rag_search success', {
          query: args.query,
          resultCount: result.total_results,
          processing_time_ms: result.processing_time_ms,
        });

        return formatted;
      } catch (error) {
        console.error('[tool:rag_search] error', {
          query: args.query,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  }),
} as const satisfies ToolDefinition;
