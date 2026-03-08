import { v } from 'convex/values';

import type { SearchResponse } from '../../../agent_tools/rag/format_search_results';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { RagActionParams } from './helpers/types';

import { fetchJson } from '../../../../lib/utils/type-cast-helpers';
import { deleteDocumentById } from './helpers/delete_document';
import { getRagConfig } from './helpers/get_rag_config';
import { uploadDocument } from './helpers/upload_document';

const SEARCH_TIMEOUT_MS = 30_000;

export const ragAction: ActionDefinition<RagActionParams> = {
  type: 'rag',
  title: 'RAG Document Manager',
  description:
    'Upload, delete, or search documents in RAG service for semantic search and retrieval',

  parametersValidator: v.union(
    v.object({
      operation: v.literal('upload_document'),
      recordId: v.string(),
      sync: v.optional(v.boolean()),
    }),
    v.object({
      operation: v.literal('delete_document'),
      recordId: v.string(),
    }),
    v.object({
      operation: v.literal('search'),
      query: v.string(),
      documentIds: v.array(v.string()),
      topK: v.optional(v.number()),
      similarityThreshold: v.optional(v.number()),
    }),
  ),

  async execute(ctx, params) {
    const startTime = Date.now();
    const { serviceUrl } = getRagConfig();

    switch (params.operation) {
      case 'upload_document': {
        const result = await uploadDocument(ctx, serviceUrl, params.recordId, {
          sync: params.sync,
        });
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
      case 'delete_document': {
        const result = await deleteDocumentById({
          ragServiceUrl: serviceUrl,
          documentId: params.recordId,
        });
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
      case 'search': {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          SEARCH_TIMEOUT_MS,
        );

        try {
          const response = await fetch(`${serviceUrl}/api/v1/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: params.query,
              document_ids: params.documentIds,
              top_k: params.topK ?? 10,
              similarity_threshold: params.similarityThreshold ?? 0.0,
              include_metadata: true,
            }),
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            throw new Error(
              `RAG search error (${response.status}): ${errorText || 'Unknown error'}`,
            );
          }

          const result = await fetchJson<SearchResponse>(response);
          return {
            results: result.results,
            totalResults: result.total_results,
            processingTimeMs: result.processing_time_ms,
            executionTimeMs: Date.now() - startTime,
          };
        } catch (error) {
          clearTimeout(timeoutId);
          if (error instanceof Error && error.name === 'AbortError') {
            throw new Error(
              `RAG search timed out after ${SEARCH_TIMEOUT_MS / 1000}s`,
              { cause: error },
            );
          }
          throw error;
        }
      }
    }
  },
};
