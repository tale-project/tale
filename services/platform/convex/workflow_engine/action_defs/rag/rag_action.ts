import { v } from 'convex/values';

import { internal } from '../../../_generated/api';
import type { ActionCtx } from '../../../_generated/server';
import { fetchDocumentChunks } from '../../../agent_tools/rag/helpers/fetch_document_chunks';
import { stripReservedPromptTags } from '../../../lib/agent_response/sanitize_prompt';
import { orgSlugFromId } from '../../../lib/helpers/org_slug';
import { buildRagSearchFilters } from '../../../lib/helpers/rag_metadata_filters';
import { toId } from '../../../lib/type_cast_helpers';
import { wrapUntrusted } from '../../../lib/untrusted_content';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { deleteDocumentById } from './helpers/delete_document';
import type { RagActionParams } from './helpers/types';
import { uploadDocument } from './helpers/upload_document';

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
      folderPath: v.optional(v.string()),
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
      folderPath: v.optional(v.string()),
      metadataFilters: v.optional(
        v.record(
          v.string(),
          v.union(
            v.string(),
            v.number(),
            v.boolean(),
            v.array(v.union(v.string(), v.number(), v.boolean())),
          ),
        ),
      ),
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
        // Cross-tenant gate: without this, org A's workflow can force
        // ingestion of org B's storage blob (the helper would resolve
        // org B's slug from file metadata and index into org B's RAG
        // namespace — cost shift + content injection). Mirror the
        // delete/get_chunks/search ops which all gate first.
        await assertStorageIdsInOrg(ctx, _variables, [migratedParams.fileId]);
        const result = await uploadDocument(ctx, migratedParams.fileId, {
          sync: migratedParams.sync,
          fileName: migratedParams.fileName,
          contentType: migratedParams.contentType,
          folderPath: migratedParams.folderPath,
        });
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
      case 'delete_document': {
        // Cross-tenant gate: even though RAG now scopes DELETE by org_slug,
        // verify the workflow's org owns the storage row first so a foreign
        // file_id surfaces as the documented error (not silently 0 deletes).
        const orgId = await assertStorageIdsInOrg(ctx, _variables, [
          migratedParams.fileId,
        ]);
        const orgSlug = await orgSlugFromId(ctx, orgId);
        const result = await deleteDocumentById(ctx, {
          orgSlug,
          fileId: migratedParams.fileId,
        });
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
      case 'get_chunks': {
        // Cross-tenant gate: even with RAG's data-layer org_slug filter,
        // verify the storage id belongs to the workflow's org so a foreign
        // file_id surfaces as the documented error (not a confusing 404).
        const orgId = await assertStorageIdsInOrg(ctx, _variables, [
          migratedParams.fileId,
        ]);
        const orgSlug = await orgSlugFromId(ctx, orgId);
        const result = await fetchDocumentChunks(
          ctx,
          orgSlug,
          migratedParams.fileId,
        );
        // SEC1: indexed-doc chunks may contain `<system>…</system>` or
        // other reserved wrapper tags that would otherwise escape the
        // workflow's downstream system prompt. Strip BEFORE any further
        // wrapping (the video-link `wrapUntrusted` then layers on top).
        // Mirrors `rag_search_tool.ts:319` (agent-tool retrieve path).
        // Also strip the document `title` — it's the user-uploaded
        // filename and flows into downstream template renderings the
        // same way `r.content` does.
        result.chunks = result.chunks.map((c) => ({
          ...c,
          content: stripReservedPromptTags(c.content),
        }));
        if (result.title) {
          result.title = stripReservedPromptTags(result.title);
        }
        // Prompt-injection defense: video-link-sourced chunks contain
        // attacker-controlled transcript text. Mirror the wrap that
        // `rag_search_tool.ts` applies on the agent-tool side.
        const videoSources = await ctx.runQuery(
          internal.file_metadata.internal_queries.lookupVideoLinkSources,
          { storageIds: [toId<'_storage'>(migratedParams.fileId)] },
        );
        if (videoSources.length > 0) {
          const meta: { tool: string; operation: string; url?: string } = {
            tool: 'rag_action',
            operation: 'get_chunks',
          };
          if (videoSources[0].sourceUrl) meta.url = videoSources[0].sourceUrl;
          result.chunks = result.chunks.map((c) => ({
            ...c,
            content: wrapUntrusted(c.content, meta),
          }));
        }
        return { ...result, executionTimeMs: Date.now() - startTime };
      }
      case 'search': {
        // Cross-tenant gate: same rationale as get_chunks. Caller-supplied
        // fileIds must be verified against the workflow's organizationId
        // before reaching the RAG service, which would otherwise serve
        // any file by id regardless of tenant.
        const orgId = await assertStorageIdsInOrg(
          ctx,
          _variables,
          migratedParams.fileIds,
        );
        const orgSlug = await orgSlugFromId(ctx, orgId);
        // Pre-retrieval narrowing filters (#1517): folder prefix + flat
        // metadata equality/IN. Narrowing-only — `fileIds` (gated above) stays
        // the authorization boundary.
        //
        // NOTE: the in-process `internal.rag.search.search` action currently
        // only forwards folder-path narrowing; the flat `metadataFilters`
        // equality/IN pre-filter that the external `/api/v1/search` `filters`
        // object supported is NOT yet exposed by the action. Folder-path
        // narrowing is preserved; flat metadata pre-filtering is a known gap
        // (mirrors `query_rag_context.ts`).
        const searchFilters = buildRagSearchFilters({
          folderPath: migratedParams.folderPath,
          metadata: migratedParams.metadataFilters,
        });

        // The RAG search logic now lives in a Convex internal action; the HTTP
        // call (and its AbortController timeout) was replaced by an in-process
        // `ctx.runAction`. The action throws plain Errors on failure.
        const searchResult = await ctx.runAction(internal.rag.search.search, {
          orgSlug,
          query: migratedParams.query,
          fileIds: migratedParams.fileIds,
          topK: migratedParams.topK ?? 10,
          similarityThreshold: migratedParams.similarityThreshold ?? 0.0,
          folderPath: searchFilters?.folder_path ?? null,
        });

        // SEC1: strip reserved wrapper tags from every prompt-bound field on
        // each search hit. `content` is the obvious one; `filename` is
        // user-uploaded (any user with write access can name a file
        // `</system><system>…`) — both end up in downstream workflow templates
        // the same way `content` does, so they need the same defense.
        let wrappedResults = searchResult.results.map((r) => {
          const mapped: {
            content: string;
            score: number;
            file_id?: string;
            filename?: string;
            source_created_at: string | null;
            source_modified_at: string | null;
          } = {
            content: stripReservedPromptTags(r.content),
            score: r.score,
            source_created_at: r.source_created_at,
            source_modified_at: r.source_modified_at,
          };
          if (r.file_id != null) mapped.file_id = r.file_id;
          if (r.filename != null) {
            mapped.filename = stripReservedPromptTags(r.filename);
          }
          return mapped;
        });
        if (wrappedResults.length > 0) {
          const fileIds = wrappedResults
            .map((r) => r.file_id)
            .filter((id): id is string => Boolean(id));
          if (fileIds.length > 0) {
            const videoSources = await ctx.runQuery(
              internal.file_metadata.internal_queries.lookupVideoLinkSources,
              {
                storageIds: fileIds.map((id) => toId<'_storage'>(id)),
              },
            );
            if (videoSources.length > 0) {
              const byId = new Map(
                videoSources.map((src) => [
                  String(src.storageId),
                  src.sourceUrl,
                ]),
              );
              wrappedResults = wrappedResults.map((r) => {
                if (!r.file_id || !byId.has(r.file_id)) return r;
                const meta: {
                  tool: string;
                  operation: string;
                  url?: string;
                } = { tool: 'rag_action', operation: 'search' };
                const url = byId.get(r.file_id);
                if (url) meta.url = url;
                return { ...r, content: wrapUntrusted(r.content, meta) };
              });
            }
          }
        }
        return {
          results: wrappedResults,
          totalResults: wrappedResults.length,
          processingTimeMs: Date.now() - startTime,
          executionTimeMs: Date.now() - startTime,
        };
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
): Promise<string> {
  const organizationId =
    typeof variables.organizationId === 'string'
      ? variables.organizationId
      : undefined;
  if (!organizationId) {
    throw new Error(
      'organizationId is required in workflow variables for RAG operations',
    );
  }
  if (storageIds.length === 0) return organizationId;
  const ownsStorage = await ctx.runQuery(
    internal.documents.internal_queries.verifyStorageIdsBelongToOrg,
    { organizationId, storageIds },
  );
  if (!ownsStorage) {
    throw new Error('One or more file ids do not belong to this organization');
  }
  return organizationId;
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
