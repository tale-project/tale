import type { ToolCtx } from '@convex-dev/agent';
import type { z } from 'zod/v4';

import type { documentRetrieveArgs } from '../document_retrieve_tool';

import { fetchJson } from '../../../../lib/utils/type-cast-helpers';
import { internal } from '../../../_generated/api';
import { createDebugLog } from '../../../lib/debug_log';
import { getRagConfig } from '../../../lib/helpers/rag_config';

const debugLog = createDebugLog('DEBUG_AGENT_TOOLS', '[AgentTools]');

const MAX_CONTENT_CHARS = 50_000;
const FETCH_TIMEOUT_MS = 60_000;

export type RetrieveDocumentArgs = z.infer<typeof documentRetrieveArgs>;

export interface DocumentRetrieveResult {
  documentId: string;
  name: string;
  content: string;
  chunkRange: { start: number; end: number };
  totalChunks: number;
  truncated: boolean;
  totalChars: number;
}

interface RagContentResponse {
  document_id: string;
  title: string | null;
  content: string;
  chunk_range: { start: number; end: number };
  total_chunks: number;
  total_chars: number;
}

export async function retrieveDocument(
  ctx: ToolCtx,
  args: RetrieveDocumentArgs,
): Promise<DocumentRetrieveResult> {
  const { organizationId, userId } = ctx;

  if (!organizationId) {
    throw new Error(
      'organizationId is required in context for retrieving documents',
    );
  }
  if (!userId) {
    throw new Error('userId is required in context for retrieving documents');
  }

  debugLog('tool:document_retrieve start', {
    documentId: args.documentId,
    chunkStart: args.chunkStart,
    chunkEnd: args.chunkEnd,
  });

  const accessibleIds: string[] = await ctx.runQuery(
    internal.documents.internal_queries.getAccessibleDocumentIds,
    { organizationId, userId },
  );

  if (!accessibleIds.includes(args.documentId)) {
    throw new Error(
      `Document not found or access denied: "${args.documentId}". ` +
        'The document may not exist, may not be indexed yet, or you may not have access.',
    );
  }

  const ragServiceUrl = getRagConfig().serviceUrl;
  const params = new URLSearchParams();
  if (args.chunkStart != null) {
    params.set('chunk_start', String(args.chunkStart));
  }
  if (args.chunkEnd != null) {
    params.set('chunk_end', String(args.chunkEnd));
  }
  const query = params.toString();
  const url = `${ragServiceUrl}/api/v1/documents/${encodeURIComponent(args.documentId)}/content${query ? `?${query}` : ''}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.status === 404) {
      throw new Error(
        `Document "${args.documentId}" was not found in the knowledge base. ` +
          'It may not have been indexed yet. Check ragInfo status via document_list.',
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `RAG service error (${response.status}): ${errorText || 'Unknown error'}`,
      );
    }

    let result: RagContentResponse;
    try {
      result = await fetchJson<RagContentResponse>(response);
    } catch (parseError) {
      throw new Error(
        `Failed to parse RAG response: ${parseError instanceof Error ? parseError.message : 'unknown error'}`,
        { cause: parseError },
      );
    }

    const rawContent = result.content ?? '';
    const truncated = rawContent.length > MAX_CONTENT_CHARS;
    const content = truncated
      ? rawContent.slice(0, MAX_CONTENT_CHARS)
      : rawContent;

    debugLog('tool:document_retrieve success', {
      documentId: args.documentId,
      totalChunks: result.total_chunks,
      totalChars: result.total_chars,
      truncated,
    });

    return {
      documentId: result.document_id,
      name: result.title ?? 'Untitled',
      content,
      chunkRange: result.chunk_range,
      totalChunks: result.total_chunks,
      truncated,
      totalChars: result.total_chars,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(
        `RAG service timed out after ${FETCH_TIMEOUT_MS / 1000}s while retrieving document "${args.documentId}".`,
        { cause: error },
      );
    }

    console.error('[tool:document_retrieve] error', {
      documentId: args.documentId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
