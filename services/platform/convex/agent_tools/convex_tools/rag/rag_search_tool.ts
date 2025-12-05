/**
 * Convex Tool: RAG Search
 *
 * Search the RAG knowledge base for relevant context using semantic search.
 */

import { z } from 'zod';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../../types';

import { createDebugLog } from '../../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface SearchResult {
  content: string;
  score: number;
  document_id?: string;
  metadata?: Record<string, unknown>;
}

interface QueryResponse {
  success: boolean;
  query: string;
  results: SearchResult[];
  total_results: number;
  processing_time_ms: number;
}

/**
 * Get RAG service URL from environment or variables
 */
function getRagServiceUrl(variables?: Record<string, unknown>): string {
  const url =
    (variables?.ragServiceUrl as string) ||
    process.env.RAG_URL ||
    'http://localhost:8001';

  return url;
}

export const ragSearchTool = {
  name: 'rag_search' as const,
  tool: createTool({
    description: `Search the RAG knowledge base for relevant context using semantic search.
Returns the most relevant document chunks based on the query.
Use this tool to find information from previously uploaded documents, websites, or other knowledge sources.`,
    args: z.object({
      query: z.string().describe('Search query text'),
      top_k: z
        .number()
        .optional()
        .describe('Number of results to return (default: 5, max: 20)'),
      similarity_threshold: z
        .number()
        .optional()
        .describe(
          'Minimum similarity score (0.0-1.0). Results below this threshold will be filtered out.',
        ),
      include_metadata: z
        .boolean()
        .optional()
        .describe('Whether to include metadata in results (default: true)'),
    }),
    handler: async (ctx: ToolCtx, args): Promise<QueryResponse> => {
      // Get variables from context (injected by agent caller)
      const { variables } = ctx;

      const ragServiceUrl = getRagServiceUrl(variables);

      debugLog('tool:rag_search start', {
        query: args.query,
        top_k: args.top_k,
        ragServiceUrl,
      });

      const url = `${ragServiceUrl}/api/v1/search`;

      const payload = {
        query: args.query,
        top_k: args.top_k || 5,
        similarity_threshold: args.similarity_threshold || 0.0001,
        include_metadata: args.include_metadata !== false,
      };

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

        const result = (await response.json()) as QueryResponse;

        debugLog('tool:rag_search success', {
          query: args.query,
          total_results: result.total_results,
          processing_time_ms: result.processing_time_ms,
        });

        return result;
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
