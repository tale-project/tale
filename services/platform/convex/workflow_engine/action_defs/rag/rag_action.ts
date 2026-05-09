import { v } from 'convex/values';

import { fetchJson } from '../../../../lib/utils/type-cast-helpers';
import { internal } from '../../../_generated/api';
import type { ActionCtx } from '../../../_generated/server';
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

  async execute(ctx, params, _variables) {
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
        // Cross-tenant gate: workflow params can carry caller-controlled
        // file ids from upstream steps, and the RAG service has no per-org
        // namespace — file_id is global. Mirror the `compare` branch in
        // document_action.ts:333-354 by verifying the storage id belongs
        // to the workflow's org before forwarding to RAG.
        await assertStorageIdsInOrg(ctx, _variables, [migratedParams.fileId]);
        const result = await fetchDocumentChunks(migratedParams.fileId);
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
      case 'search': {
        // Cross-tenant gate: same rationale as get_chunks. Caller-supplied
        // fileIds must be verified against the workflow's organizationId
        // before reaching the RAG service, which would otherwise serve
        // any file by id regardless of tenant.
        await assertStorageIdsInOrg(ctx, _variables, migratedParams.fileIds);
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
 * Cross-tenant gate for RAG operations that take caller-supplied
 * `fileId` / `fileIds`. The RAG service has no per-org namespace; any
 * `file_id` reaches any tenant's data. Verify against the workflow's
 * `_variables.organizationId` before forwarding to RAG.
 *
 * Mirrors the `compare` branch in `document_action.ts:333-354`.
 */
async function assertStorageIdsInOrg(
  ctx: ActionCtx,
  variables: Record<string, unknown>,
  storageIds: string[],
): Promise<void> {
  const organizationId =
    typeof variables.organizationId === 'string'
      ? variables.organizationId
      : undefined;
  if (!organizationId) {
    throw new Error(
      'organizationId is required in workflow variables for RAG operations',
    );
  }
  if (storageIds.length === 0) return;
  const ownsStorage = await ctx.runQuery(
    internal.documents.internal_queries.verifyStorageIdsBelongToOrg,
    { organizationId, storageIds },
  );
  if (!ownsStorage) {
    throw new Error('One or more file ids do not belong to this organization');
  }
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
