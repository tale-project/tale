/**
 * Convex Tool: RAG Search
 *
 * Search the RAG knowledge base for relevant context using semantic search.
 * Uses team IDs passed from the parent context (resolved in mutation where auth identity is available).
 */

import { z } from 'zod/v4';
import { createTool } from '@convex-dev/agent';
import type { ToolCtx } from '@convex-dev/agent';
import type { ToolDefinition } from '../types';
import { TEAM_DATASET_PREFIX } from '../../lib/get_user_teams';
import { createDebugLog } from '../../lib/debug_log';

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
 * Get RAG service URL from environment variable
 */
function getRagServiceUrl(): string {
  return process.env.RAG_URL || 'http://localhost:8001';
}

export const ragSearchTool = {
  name: 'rag_search' as const,
  tool: createTool({
    description: `Search the knowledge base using semantic/vector similarity search.

PERFORMANCE TIP: Use SMALL top_k values (3-5) for faster responses. Larger values significantly slow down processing.

IMPORTANT LIMITATIONS:
• Returns only the TOP matching chunks (default 5, max 20)
• NOT suitable for: counting records, listing all items, aggregate queries
• For counting/listing/filtering, use database tools (customer_read, product_read, workflow_read) instead

WHEN TO USE THIS TOOL:
• Semantic/meaning-based search: "Find customers interested in sustainability"
• Knowledge base lookups: policies, procedures, documentation
• Finding information when you don't know exact field values
• Complex contextual questions about stored documents

WHEN NOT TO USE:
• "How many customers?" → Use customer_read with operation='list'
• "List all products" → Use product_read with operation='list'
• "Show customers with status=churned" → Use customer_read with filtering

TOP_K GUIDANCE (IMPORTANT - affects response speed):
• top_k=3-5: RECOMMENDED for most queries - fast response, high-quality results
• top_k=10: Only when you need broader context (slower)
• top_k=15-20: Only for comprehensive enumeration queries (much slower):
  - "List ALL chapters/sections/topics"
  - "Give me a COMPLETE summary/overview"
  - "What are ALL the key points?"

Returns the most relevant document chunks based on semantic similarity to your query.`,
    args: z.object({
      query: z.string().describe('Search query text'),
      top_k: z
        .number()
        .optional()
        .describe('Number of results (default: 5, max: 20). Use 3-5 for best performance. Only increase for comprehensive queries.'),
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
      // Get user ID, team IDs, and prefetch cache from context
      // userId is provided by Agent SDK from thread.userId
      // userTeamIds is passed from generateAgentResponse (resolved in mutation where auth identity is available)
      // ragPrefetchCache is set by generateAgentResponse for the first call
      const { userId, userTeamIds, ragPrefetchCache } = ctx;

      debugLog('tool:rag_search start', {
        query: args.query,
        top_k: args.top_k,
        hasPrefetchCache: !!ragPrefetchCache,
        prefetchConsumed: ragPrefetchCache?.consumed,
      });

      // First call: use prefetched result if available
      if (ragPrefetchCache && !ragPrefetchCache.consumed) {
        ragPrefetchCache.consumed = true;

        try {
          const result = await ragPrefetchCache.promise;

          debugLog('tool:rag_search using prefetched result (first call)', {
            aiQuery: args.query,
            prefetchAge: Date.now() - ragPrefetchCache.timestamp,
            total_results: result.total_results,
            processing_time_ms: result.processing_time_ms,
          });

          return result;
        } catch (error) {
          // Prefetch failed, fall through to make a fresh request
          debugLog('tool:rag_search prefetch failed, making fresh request', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Subsequent calls or no prefetch: make a fresh request
      const ragServiceUrl = getRagServiceUrl();
      const url = `${ragServiceUrl}/api/v1/search`;

      // Default similarity_threshold of 0.3 balances recall and precision:
      // - Lower values (< 0.3) include more marginal matches, increasing noise
      // - Higher values (> 0.5) filter too aggressively, missing relevant results
      // - 0.3 is a common baseline for embedding-based search with cosine similarity
      const payload: Record<string, unknown> = {
        query: args.query,
        top_k: args.top_k || 5,
        similarity_threshold: args.similarity_threshold ?? 0.3,
        include_metadata: args.include_metadata !== false,
      };

      if (!userId) {
        throw new Error(
          'rag_search requires userId in ToolCtx. ' +
          'Ensure the thread was created with a userId.'
        );
      }

      payload.user_id = userId;

      // Pass team IDs directly - RAG service converts them to datasets internally
      const teamIds = userTeamIds ?? [];
      if (teamIds.length === 0) {
        throw new Error(
          'rag_search requires at least one team ID. ' +
          'Ensure userTeamIds is provided in ToolCtx.'
        );
      }

      payload.team_ids = teamIds;
      debugLog('tool:rag_search team_ids resolved', {
        userId,
        userTeamIds: teamIds,
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
