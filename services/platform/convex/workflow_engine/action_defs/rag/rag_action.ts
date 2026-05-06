import { v } from 'convex/values';

import { fetchJson } from '../../../../lib/utils/type-cast-helpers';
import type { SearchResponse } from '../../../agent_tools/rag/format_search_results';
import { fetchDocumentChunks } from '../../../agent_tools/rag/helpers/fetch_document_chunks';
import { ragFetch } from '../../../lib/helpers/rag_config';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { deleteDocumentById } from './helpers/delete_document';
import type { RagActionParams } from './helpers/types';
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
      fileId: v.string(),
      fileName: v.optional(v.string()),
      contentType: v.optional(v.string()),
      sync: v.optional(v.boolean()),
    }),
    v.object({
      operation: v.literal('delete_document'),
      fileId: v.string(),
    }),
    v.object({
      operation: v.literal('search'),
      query: v.string(),
      fileIds: v.array(v.string()),
      topK: v.optional(v.number()),
      similarityThreshold: v.optional(v.number()),
    }),
    v.object({
      operation: v.literal('get_chunks'),
      fileId: v.string(),
    }),
  ),

  async execute(ctx, params) {
    const startTime = Date.now();

    // Backward compatibility: map old param names from user-created workflows
    const migratedParams = migrateParams(params);

    switch (migratedParams.operation) {
      case 'upload_document': {
        const result = await uploadDocument(ctx, migratedParams.fileId, {
          sync: migratedParams.sync,
          fileName: migratedParams.fileName,
          contentType: migratedParams.contentType,
        });
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
      case 'delete_document': {
        const result = await deleteDocumentById({
          fileId: migratedParams.fileId,
        });
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
      case 'get_chunks': {
        const result = await fetchDocumentChunks(migratedParams.fileId);
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
      case 'search': {
        try {
          const response = await ragFetch('/api/v1/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: migratedParams.query,
              file_ids: migratedParams.fileIds,
              top_k: migratedParams.topK ?? 10,
              similarity_threshold: migratedParams.similarityThreshold ?? 0.0,
              include_metadata: true,
            }),
            timeoutMs: SEARCH_TIMEOUT_MS,
          });

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
          if (
            error instanceof Error &&
            (error.name === 'AbortError' || error.name === 'TimeoutError')
          ) {
            throw new Error(
              `RAG search timed out after ${SEARCH_TIMEOUT_MS / 1000}s`,
              { cause: error },
            );
          }
          throw error;
        }
      }
    }
    return undefined;
  },
};

/**
 * Backward compatibility: map old param names (recordId, documentIds)
 * to new names (fileId, fileIds) for user-created workflows stored in DB.
 */
function migrateParams(params: Record<string, unknown>): RagActionParams {
  const migrated = { ...params };

  if ('recordId' in migrated && !('fileId' in migrated)) {
    migrated.fileId = migrated.recordId;
    delete migrated.recordId;
  }
  if ('documentIds' in migrated && !('fileIds' in migrated)) {
    migrated.fileIds = migrated.documentIds;
    delete migrated.documentIds;
  }

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- backward compat migration
  return migrated as unknown as RagActionParams;
}
