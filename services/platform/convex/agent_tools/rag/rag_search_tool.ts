/**
 * Convex Tool: RAG Search
 *
 * Search the knowledge base and return relevant document chunks.
 * Resolves accessible document IDs from Convex and passes them to RAG at query time.
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { fetchJson } from '../../../lib/utils/type-cast-helpers';
import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { getRagConfig } from '../../lib/helpers/rag_config';
import {
  formatSearchResults,
  type SearchResponse,
} from './format_search_results';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const DEFAULT_TOP_K = 10;
const DEFAULT_SIMILARITY_THRESHOLD = 0.3;

export const ragSearchTool = {
  name: 'rag_search' as const,
  tool: createTool({
    description: `Search the knowledge base for relevant document excerpts.

This tool uses hybrid search (BM25 + vector similarity) to find the most
relevant chunks from the knowledge base. You receive the raw excerpts with
relevance scores and should synthesize the answer yourself.

WHEN TO USE THIS TOOL:
• Knowledge base lookups: policies, procedures, documentation
• Questions about stored documents and content
• Finding information when you don't know exact field values

WHEN NOT TO USE:
• "How many customers?" → Use customer_read with operation='list'
• "List all products" → Use product_read with operation='list'
• "Show customers with status=churned" → Use customer_read with filtering
• For counting/listing/filtering, use database tools instead

Returns numbered document excerpts with relevance scores.`,
    args: z.object({
      query: z.string().describe('Query text to search the knowledge base for'),
    }),
    handler: async (ctx: ToolCtx, args): Promise<string> => {
      const { userId, organizationId } = ctx;

      debugLog('tool:rag_search start', { query: args.query });

      if (!userId || !organizationId) {
        throw new Error(
          'rag_search requires userId and organizationId in ToolCtx. ' +
            'Ensure the thread was created with proper context.',
        );
      }

      const fileIds: string[] = await ctx.runQuery(
        internal.documents.internal_queries.getAccessibleFileIds,
        { organizationId, userId },
      );

      if (fileIds.length === 0) {
        return 'No documents available in the knowledge base. Upload documents first.';
      }

      const ragServiceUrl = getRagConfig().serviceUrl;
      const url = `${ragServiceUrl}/api/v1/search`;

      const payload = {
        query: args.query,
        document_ids: fileIds,
        top_k: DEFAULT_TOP_K,
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
