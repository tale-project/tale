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
 * All agents are agents; the agent's knowledge config is the sole
 * authorization boundary for RAG file access.
 */

import type { ToolCtx } from '@convex-dev/agent';
import { createTool } from '@convex-dev/agent';
import { z } from 'zod/v4';

import { fetchJson } from '../../../lib/utils/type-cast-helpers';
import { internal } from '../../_generated/api';
import { createDebugLog } from '../../lib/debug_log';
import { getRagConfig } from '../../lib/helpers/rag_config';
import type { ToolDefinition } from '../types';
import {
  formatSearchResults,
  type SearchResponse,
} from './format_search_results';
import { listIndexedDocuments } from './helpers/list_indexed_documents';

// ToolCtx from @convex-dev/agent does not include our agent knowledge
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

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ToolCtx from @convex-dev/agent lacks our agent knowledge properties injected at runtime
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
  z.object({
    operation: z.literal('retrieve'),
    fileId: z
      .string()
      .describe(
        'File ID of the document to retrieve content from (e.g., "kg2bazp7fbgt9srq63knfagjrd7yfenj")',
      ),
    chunkStart: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Start chunk index (1-based, default 1)'),
    chunkEnd: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('End chunk index (inclusive, default chunkStart + 9)'),
  }),
]);

export const ragSearchTool = {
  name: 'rag_search' as const,
  tool: createTool({
    description: `Knowledge base tool for searching, retrieving, and listing indexed documents.

OPERATIONS:
• 'search': Search the knowledge base for relevant document excerpts using hybrid search (BM25 + vector similarity). Returns numbered excerpts with relevance scores.
• 'retrieve': Retrieve document content by file ID in paginated chunks (default 10 chunks per call). Use chunkStart/chunkEnd to paginate. Returns chunk range and totalChunks so you can fetch more. Use this to read uploaded files (PDF, DOCX, PPTX, TXT, XLSX, etc.).
• 'list_indexed': List documents that have been indexed in the knowledge base. Returns file names, file IDs, and modification dates. Use this to see what's available before searching.

WHEN TO USE 'search':
• Knowledge base lookups: policies, procedures, documentation
• Questions about stored documents and content
• Finding information when you don't know exact field values

WHEN TO USE 'retrieve':
• Reading content of a specific uploaded file (paginated, 10 chunks per call by default)
• When a user uploads a file and asks you to read, summarize, or analyze it
• For large documents, retrieve returns the first page — use chunkStart/chunkEnd to read more, or use 'search' with a query for targeted lookup

WHEN TO USE 'list_indexed':
• See which files are available for RAG search
• Get file IDs for use with the search or retrieve operations
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
    execute: async (ctx: ToolCtx, args) => {
      if (args.operation === 'list_indexed') {
        return listIndexedDocuments(ctx, {
          limit: args.limit,
          cursor: args.cursor,
        });
      }

      if (args.operation === 'retrieve') {
        const DEFAULT_PAGE_SIZE = 10;
        const start = args.chunkStart ?? 1;
        const end = args.chunkEnd ?? start + DEFAULT_PAGE_SIZE - 1;

        debugLog('tool:rag_search retrieve start', {
          fileId: args.fileId,
          chunkStart: start,
          chunkEnd: end,
        });

        const ragServiceUrl = getRagConfig().serviceUrl;
        const url = `${ragServiceUrl}/api/v1/documents/${encodeURIComponent(args.fileId)}/content?return_chunks=true&chunk_start=${start}&chunk_end=${end}`;
        const response = await fetch(url);

        if (!response.ok) {
          const errorText = await response.text().catch(() => '');
          return {
            success: false,
            response: `Failed to retrieve document: ${response.status} ${errorText}`,
          };
        }

        interface RetrieveResponse {
          file_id: string;
          title: string | null;
          total_chunks: number;
          total_chars: number;
          chunk_range: { start: number; end: number };
          chunks: Array<{ index: number; content: string }> | null;
        }
        const result = await fetchJson<RetrieveResponse>(response);

        const text = (result.chunks ?? [])
          .sort((a, b) => a.index - b.index)
          .map((c) => c.content)
          .join('\n');

        const hasMore = result.chunk_range.end < result.total_chunks;

        debugLog('tool:rag_search retrieve success', {
          fileId: args.fileId,
          chunkRange: result.chunk_range,
          totalChunks: result.total_chunks,
          textLength: text.length,
          hasMore,
        });

        return {
          success: true,
          response: text || 'Document has no text content.',
          title: result.title,
          totalChunks: result.total_chunks,
          chunkRange: result.chunk_range,
          hasMore,
        };
      }

      // operation === 'search'
      debugLog('tool:rag_search start', {
        query: args.query,
        explicitFileIds: args.fileIds?.length,
      });

      const fileIds = await resolveFileIds(ctx, args.fileIds);

      if (fileIds.length === 0) {
        return {
          success: true,
          response:
            'No documents available in the knowledge base. Upload documents first.',
        };
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
          usage: result.usage,
        });

        return {
          success: true,
          response: formatted,
          output: formatted,
          ...(result.usage && {
            usage: {
              inputTokens: result.usage.input_tokens,
              outputTokens: result.usage.output_tokens ?? 0,
              totalTokens: result.usage.total_tokens,
            },
            model: result.usage.model,
          }),
        };
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
