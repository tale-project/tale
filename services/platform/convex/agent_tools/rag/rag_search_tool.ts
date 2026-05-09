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
import { ragFetch } from '../../lib/helpers/rag_config';
import { getThreadAncestorChain } from '../../threads/get_thread_ancestor_chain';
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
  agentTeamIds?: string[];
  includeTeamKnowledge?: boolean;
  includeOrgKnowledge?: boolean;
  knowledgeFileIds?: string[];
}

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const DEFAULT_TOP_K = 10;
const DEFAULT_SIMILARITY_THRESHOLD = 0.3;

/**
 * Resolve the agent's pre-configured RAG scope (the default-search
 * allow-list, computed from `agentTeamId` / `includeOrgKnowledge` /
 * `knowledgeFileIds` etc.).
 *
 * NOT a security gate. When an `explicitFileIds` array is supplied the
 * function returns it AS-IS — callers must authorize those ids
 * separately via
 * `internal.agent_tools.rag.helpers.verify_thread_scoped_access.verifyStorageIdsInThreadScope`
 * BEFORE calling this with explicit ids. The legitimate use of
 * explicit-ids passthrough is "caller already authorized; this is a
 * convenience shortcut to skip re-resolving the agent scope".
 *
 * Production callers in this file pass `undefined` for `explicitFileIds`
 * — the search-op handler routes explicit ids through the verifier
 * directly and only falls back to `resolveFileIds` for the default
 * (no-explicit-ids) branch.
 */
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
      agentTeamIds: extended.agentTeamIds,
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
        'Specific file IDs to search within. When provided, only these files are searched (skips automatic file resolution). IMPORTANT: If the user message contains file IDs (from uploaded attachments), pass them here first to prioritize those files. Retry without fileIds for a broader search if no relevant results are found.',
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
• 'list_indexed': List documents indexed in the Document Hub (does NOT include files uploaded in chat). Returns file names, file IDs, and modification dates.

WHEN TO USE 'search':
• Knowledge base lookups: policies, procedures, documentation
• Questions about stored documents and content
• Finding information when you don't know exact field values

SEARCH STRATEGY — file ID priority:
When the user's message contains file IDs (e.g. from uploaded attachments), ALWAYS pass those IDs in the 'fileIds' parameter first to search within those specific files. If that returns no relevant results, retry WITHOUT fileIds to perform a broader knowledge base search. This ensures uploaded/referenced files are prioritized while still falling back to the full knowledge base when needed.

WHEN TO USE 'retrieve':
• Reading content of a specific uploaded file (paginated, 10 chunks per call by default)
• When a user uploads a file and asks you to read, summarize, or analyze it
• For large documents, retrieve returns the first page — use chunkStart/chunkEnd to read more, or use 'search' with a query for targeted lookup

WHEN TO USE 'list_indexed':
• See which documents are in the Document Hub (org/team knowledge base)
• Get file IDs for use with the search or retrieve operations
• Check when documents were last modified
• NOTE: This only lists Document Hub files. Files uploaded in chat are NOT included — their file IDs are already in the conversation context.

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

        // Authorize the requested fileId. Same-org check is the IDOR
        // floor (RAG treats `file_id` as a global identifier; no
        // tenant filter on the documents router). For chat-bound files
        // (fileMetadata.threadId set), additionally require the bound
        // thread to be in the caller's accessible chain — current
        // thread + delegation ancestors. Document Hub and legacy /
        // integration uploads pass on same-org alone.
        //
        // Replaces commit d7bc3daa6's stricter "agent allow-list"
        // check, which blocked legitimate chat-attachment retrieval —
        // the over-strict gate ignored thread-bound uploads, since
        // chat uploads never appear in the agent's pre-configured
        // `knowledgeFileIds` / `agentTeamId` / `includeOrgKnowledge`
        // sets. Same-org + thread-scope is the correct invariant.
        const orgIdRetrieve = ctx.organizationId;
        if (!orgIdRetrieve) {
          throw new Error('rag_search requires organizationId in ToolCtx.');
        }
        const accessibleThreadsRetrieve = ctx.threadId
          ? await getThreadAncestorChain(ctx, ctx.threadId)
          : [];
        const retrieveAuthorized = await ctx.runQuery(
          internal.agent_tools.rag.helpers.verify_thread_scoped_access
            .verifyStorageIdsInThreadScope,
          {
            organizationId: orgIdRetrieve,
            accessibleThreadIds: accessibleThreadsRetrieve,
            storageIds: [args.fileId],
          },
        );
        if (!retrieveAuthorized) {
          debugLog('tool:rag_search retrieve refused (out of scope)', {
            fileId: args.fileId,
            threadId: ctx.threadId,
            chainDepth: accessibleThreadsRetrieve.length,
          });
          return {
            success: false,
            response:
              'File is not accessible from this thread or does not exist.',
          };
        }

        debugLog('tool:rag_search retrieve start', {
          fileId: args.fileId,
          chunkStart: start,
          chunkEnd: end,
        });

        const response = await ragFetch(
          `/api/v1/documents/${encodeURIComponent(args.fileId)}/content?return_chunks=true&chunk_start=${start}&chunk_end=${end}`,
        );

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
          source_created_at: string | null;
          source_modified_at: string | null;
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

        const citations = [
          {
            index: 1,
            type: 'rag' as const,
            source: result.title ?? 'Unknown',
            fileId: result.file_id,
          },
        ];

        return {
          success: true,
          response: text || 'Document has no text content.',
          citations,
          fileId: result.file_id,
          filename: result.title,
          sourceCreatedAt: result.source_created_at,
          sourceModifiedAt: result.source_modified_at,
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

      // When the agent passes explicit `fileIds` (typically chat-attachment
      // ids surfaced from the user message), do NOT trust them as-is — the
      // RAG service treats fileIds as global identifiers, so an unchecked
      // pass-through is a cross-org IDOR. Authorize each id against the
      // caller's same-org + thread-scope invariant. When no explicit ids,
      // fall through to the agent's pre-configured allow-list (default
      // "search the agent's own knowledge").
      let fileIds: string[];
      if (args.fileIds && args.fileIds.length > 0) {
        const orgIdSearch = ctx.organizationId;
        if (!orgIdSearch) {
          throw new Error('rag_search requires organizationId in ToolCtx.');
        }
        const accessibleThreadsSearch = ctx.threadId
          ? await getThreadAncestorChain(ctx, ctx.threadId)
          : [];
        const searchAuthorized = await ctx.runQuery(
          internal.agent_tools.rag.helpers.verify_thread_scoped_access
            .verifyStorageIdsInThreadScope,
          {
            organizationId: orgIdSearch,
            accessibleThreadIds: accessibleThreadsSearch,
            storageIds: args.fileIds,
          },
        );
        if (!searchAuthorized) {
          debugLog('tool:rag_search search refused (cross-scope ids)', {
            count: args.fileIds.length,
            threadId: ctx.threadId,
            chainDepth: accessibleThreadsSearch.length,
          });
          return {
            success: false,
            response:
              'One or more requested files are not accessible from this thread.',
          };
        }
        fileIds = args.fileIds;
      } else {
        fileIds = await resolveFileIds(ctx, undefined);
      }

      if (fileIds.length === 0) {
        return {
          success: true,
          response:
            'No documents available in the knowledge base. Upload documents first.',
        };
      }

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
        const response = await ragFetch('/api/v1/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
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

        // Merge citations by fileId — keep one entry per file with highest relevance
        const citationsByFile = new Map<
          string,
          { source: string; fileId?: string; relevance?: number }
        >();
        for (const r of result.results) {
          const key =
            r.file_id ?? r.filename ?? `unknown-${citationsByFile.size}`;
          const existing = citationsByFile.get(key);
          if (
            !existing ||
            (r.score != null &&
              (existing.relevance == null || r.score > existing.relevance))
          ) {
            citationsByFile.set(key, {
              source: r.filename ?? 'Unknown',
              fileId: r.file_id,
              relevance: r.score,
            });
          }
        }
        const citations = Array.from(citationsByFile.values()).map(
          (c, idx) => ({
            index: idx + 1,
            type: 'rag' as const,
            source: c.source,
            fileId: c.fileId,
            relevance: c.relevance,
          }),
        );

        debugLog('tool:rag_search success', {
          query: args.query,
          resultCount: result.total_results,
          processing_time_ms: result.processing_time_ms,
          usage: result.usage,
        });

        return {
          success: true,
          response: formatted,
          citations,
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
