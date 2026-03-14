import { v } from 'convex/values';

import type { SearchResponse } from '../../../agent_tools/rag/format_search_results';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import type { RagActionParams, RagChunkResult } from './helpers/types';

import { fetchJson } from '../../../../lib/utils/type-cast-helpers';
import { deleteDocumentById } from './helpers/delete_document';
import { getRagConfig } from './helpers/get_rag_config';
import { uploadDocument } from './helpers/upload_document';

const SEARCH_TIMEOUT_MS = 30_000;
const MAX_CHUNK_WINDOW = 200;

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
    const { serviceUrl } = getRagConfig();

    // Backward compatibility: map old param names from user-created workflows
    const migratedParams = migrateParams(params);

    switch (migratedParams.operation) {
      case 'upload_document': {
        const result = await uploadDocument(
          ctx,
          serviceUrl,
          migratedParams.fileId,
          {
            sync: migratedParams.sync,
            fileName: migratedParams.fileName,
            contentType: migratedParams.contentType,
          },
        );
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
      case 'delete_document': {
        const result = await deleteDocumentById({
          ragServiceUrl: serviceUrl,
          fileId: migratedParams.fileId,
        });
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
      case 'get_chunks': {
        const result = await fetchDocumentChunks(
          serviceUrl,
          migratedParams.fileId,
        );
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
              query: migratedParams.query,
              document_ids: migratedParams.fileIds,
              top_k: migratedParams.topK ?? 10,
              similarity_threshold: migratedParams.similarityThreshold ?? 0.0,
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

interface DocumentContentResponse {
  document_id: string;
  title: string | null;
  content: string;
  chunk_range: { start: number; end: number };
  total_chunks: number;
  total_chars: number;
  chunks: Array<{ index: number; content: string }> | null;
}

async function fetchDocumentChunks(
  serviceUrl: string,
  fileId: string,
): Promise<RagChunkResult> {
  const allChunks: Array<{ index: number; content: string }> = [];
  let totalChunks = 0;
  let documentId = '';
  let title: string | null = null;
  let chunkStart = 1;

  // Paginate through all chunks in MAX_CHUNK_WINDOW batches
  while (true) {
    const chunkEnd = chunkStart + MAX_CHUNK_WINDOW - 1;
    const url = `${serviceUrl}/api/v1/documents/${encodeURIComponent(fileId)}/content?return_chunks=true&chunk_start=${chunkStart}&chunk_end=${chunkEnd}`;

    const response = await fetch(url);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(
        `RAG get_chunks error (${response.status}): ${errorText || 'Unknown error'}`,
      );
    }

    const result = await fetchJson<DocumentContentResponse>(response);
    documentId = result.document_id;
    title = result.title;
    totalChunks = result.total_chunks;

    if (result.chunks) {
      allChunks.push(...result.chunks);
    }

    if (result.chunk_range.end >= totalChunks) {
      break;
    }

    chunkStart = result.chunk_range.end + 1;
  }

  return { documentId, title, chunks: allChunks, totalChunks };
}

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
