/**
 * Convex Tool: RAG Generate
 *
 * Generate responses using the RAG knowledge base.
 * Uses team IDs passed from the parent context (resolved in mutation where auth identity is available).
 */

import type { ToolCtx } from '@convex-dev/agent';

import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import type { ToolDefinition } from '../types';

import { createDebugLog } from '../../lib/debug_log';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

interface RagServiceResponse {
  success: boolean;
  query: string;
  response: string;
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
    description: `Query the knowledge base and get a generated response.

This tool uses RAG (Retrieval-Augmented Generation) to:
1. Search for relevant context from the knowledge base
2. Generate a comprehensive answer based on that context

WHEN TO USE THIS TOOL:
• Knowledge base lookups: policies, procedures, documentation
• Questions about stored documents and content
• Finding information when you don't know exact field values

WHEN NOT TO USE:
• "How many customers?" → Use customer_read with operation='list'
• "List all products" → Use product_read with operation='list'
• "Show customers with status=churned" → Use customer_read with filtering
• For counting/listing/filtering, use database tools instead

Returns a generated response based on the most relevant documents.`,
    args: z.object({
      query: z
        .string()
        .describe('Query text to search and generate response for'),
    }),
    handler: async (ctx: ToolCtx, args): Promise<string> => {
      const { userId, userTeamIds, ragPrefetchCache } = ctx;

      debugLog('tool:rag_search start', {
        query: args.query,
        hasPrefetchCache: !!ragPrefetchCache,
        prefetchConsumed: ragPrefetchCache?.consumed,
      });

      // First call: use prefetched result if available
      if (ragPrefetchCache && !ragPrefetchCache.consumed) {
        ragPrefetchCache.consumed = true;

        try {
          const response = await ragPrefetchCache.promise;

          if (response) {
            debugLog('tool:rag_search using prefetched result', {
              prefetchAge: Date.now() - ragPrefetchCache.timestamp,
              responseLength: response.length,
            });
            return response;
          }
        } catch (error) {
          debugLog('tool:rag_search prefetch failed, making fresh request', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Subsequent calls or no prefetch: make a fresh request
      if (!userId) {
        throw new Error(
          'rag_search requires userId in ToolCtx. ' +
            'Ensure the thread was created with a userId.',
        );
      }

      const teamIds = userTeamIds ?? [];
      if (teamIds.length === 0) {
        throw new Error(
          'rag_search requires at least one team ID. ' +
            'Ensure userTeamIds is provided in ToolCtx.',
        );
      }

      const ragServiceUrl = getRagServiceUrl();
      const url = `${ragServiceUrl}/api/v1/generate`;

      const payload = {
        query: args.query,
        user_id: userId,
        team_ids: teamIds,
      };

      debugLog('tool:rag_search requesting generate', {
        userId,
        teamIds,
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

        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- response.json() returns unknown
        const result = (await response.json()) as RagServiceResponse;

        debugLog('tool:rag_search success', {
          query: args.query,
          responseLength: result.response.length,
          processing_time_ms: result.processing_time_ms,
        });

        return result.response;
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
