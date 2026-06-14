/**
 * Document-specific workflow actions
 *
 * These actions provide safe, specialized operations for document data in workflows.
 * They replace generic database operations with purpose-built functions that:
 * - Use Convex indexes for efficient queries
 * - Require documentId for updates to prevent accidental bulk operations
 * - Support flexible filtering on kind and metadata fields
 * - Follow Convex best practices
 */

import { v } from 'convex/values';

import { internal } from '../../../_generated/api';
import type { Doc, Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';
import { fetchDocumentComparisonByUrls } from '../../../agent_tools/documents/helpers/fetch_document_comparison';
import { fetchDocumentContent } from '../../../agent_tools/documents/helpers/fetch_document_content';
import { extractExtension } from '../../../documents/extract_extension';
import { getDocumentEffectiveDate } from '../../../documents/transform_to_document_item';
import type { DocumentMetadata } from '../../../documents/types';
import { orgSlugFromId } from '../../../lib/helpers/org_slug';
import { toConvexJsonRecord, toId } from '../../../lib/type_cast_helpers';
import { wrapUntrusted } from '../../../lib/untrusted_content';
import { jsonRecordValidator } from '../../../lib/validators/json';
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { applyDocxStructured } from './helpers/apply_docx_structured';
import { extractDocxStructured } from './helpers/extract_docx_structured';

const MAX_LIMIT = 50;

/**
 * Normalize unescaped literal \n and \t sequences to actual whitespace.
 * Uses negative lookbehind to avoid corrupting \\n (escaped backslash + n).
 * Safety net for JEXL expressions that don't interpret escape sequences.
 */
export function normalizeEscapeSequences(text: string) {
  return text.replace(/(?<!\\)\\n/g, '\n').replace(/(?<!\\)\\t/g, '\t');
}

async function resolveStorageUrl(
  ctx: ActionCtx,
  fileId: string,
): Promise<string> {
  const storageId = toId<'_storage'>(fileId);
  const fileUrl = await ctx.storage.getUrl(storageId);
  if (!fileUrl) {
    throw new Error(`File URL not available: ${fileId}`);
  }
  return fileUrl;
}

/**
 * Document-row access gate for workflow ops that resolve a `documents`
 * row by `fileId`. Mirrors the agent-tool sibling
 * `retrieve_document.ts:42-58`: same-org gate via `findDocumentByFileId`
 * (already inline in callers) PLUS team-ACL gate via
 * `getAccessibleDocumentIds` (was missing — same-org members of a
 * different team could read foreign-team documents).
 *
 * When `userId` is absent from `_variables` (system-triggered workflows
 * that don't impersonate a user), the team-ACL gate is skipped — the
 * org-membership gate above already constrains scope and there's no
 * member identity to scope further. Throws Error on access denied.
 */
async function assertDocumentAccessibleInWorkflow(
  ctx: ActionCtx,
  organizationId: string,
  userId: string | undefined,
  document: { _id: string },
  fileId: string,
): Promise<void> {
  if (!userId) return;
  const accessibleIds: string[] = await ctx.runQuery(
    internal.documents.internal_queries.getAccessibleDocumentIds,
    { organizationId, userId },
  );
  if (!accessibleIds.includes(document._id)) {
    throw new Error(
      `Access denied for document "${fileId}". ` +
        "You may not have access to this document's team.",
    );
  }
}

async function resolveFileName(
  ctx: ActionCtx,
  fileId: string,
): Promise<string> {
  const metadata = await ctx.runQuery(
    internal.file_metadata.internal_queries.getByStorageId,
    { storageId: toId<'_storage'>(fileId) },
  );
  return metadata?.fileName ?? 'Unknown';
}

type DocumentActionParams =
  | {
      operation: 'update';
      fileId: string;
      title?: string;
      content?: string;
      mimeType?: string;
      extension?: string;
      metadata?: Record<string, unknown>;
      sourceProvider?: string;
      contentHash?: string;
    }
  | {
      operation: 'retrieve';
      fileId: string;
      chunkStart?: number;
      chunkEnd?: number;
      returnChunks?: boolean;
    }
  | {
      operation: 'generate_docx';
      fileName: string;
      sourceType: 'markdown' | 'html';
      content: string;
    }
  | {
      operation: 'get_metadata';
      fileIds: string[];
    }
  | {
      operation: 'compare';
      baseFileId: string;
      comparisonFileId: string;
      baseFileName?: string;
      comparisonFileName?: string;
      maxChanges?: number;
    }
  | {
      operation: 'create';
      fileId: string;
      title?: string;
      folderPath?: string;
      /**
       * Optional sync-subtree scope for the cross-folder fallback. When two
       * independent sync configs target the same external item but different
       * Tale folders, scoping the fallback to each sync's root prevents the
       * doc from ping-ponging between rows.
       */
      folderPathPrefix?: string;
      sourceProvider?: string;
      externalItemId?: string;
      contentHash?: string;
      metadata?: Record<string, unknown>;
      /** Integration identifier stamped on the row for reconcile scoping. */
      driveId?: string;
    }
  | {
      operation: 'extract_docx_structured';
      fileId: string;
    }
  | {
      operation: 'apply_docx_structured';
      templateFileId: string;
      sourceHash: string;
      modifications: Array<{ key: string; text: string }>;
      fileName: string;
      trackChanges?: boolean;
      author?: string;
    }
  | {
      operation: 'list';
      folderPath?: string;
      extension?: string;
    }
  | {
      operation: 'index_in_rag';
      documentId: string;
    }
  | {
      operation: 'find_by_external_id';
      externalItemId: string;
      folderPath?: string;
      /**
       * Optional sync-subtree scope. Mirrors `create` — when set, the
       * lookup includes docs anywhere under this prefix (subtree), so a
       * cross-subfolder move is detected at lookup time instead of
       * triggering a wasteful download.
       */
      folderPathPrefix?: string;
    }
  | {
      operation: 'reconcile_deletes';
      sourceProvider: string;
      folderPath: string;
      presentExternalIds: string[];
      /**
       * When set, scopes the orphan candidate set to docs whose `driveId`
       * matches. Lets two sync workflows targeting the same `folderPath`
       * coexist (e.g. two Drive accounts under the default "Google Drive"
       * folder) without mutually orphaning each other.
       */
      driveId?: string;
      /**
       * When true, the upstream listing was truncated and `presentExternalIds`
       * is incomplete — reconcile must skip to avoid deleting legitimate docs.
       * Defense-in-depth: the workflow JSON should also gate this step on a
       * truncation check, but enforcing it here closes the gap if the workflow
       * is forked without that check.
       */
      truncated?: boolean;
    };

export const documentAction: ActionDefinition<DocumentActionParams> = {
  type: 'document',
  title: 'Document Operation',
  description:
    'Execute document-specific operations (list, update, retrieve, generate_docx, create, extract_docx_structured, apply_docx_structured, find_by_external_id, index_in_rag, reconcile_deletes). organizationId is automatically read from workflow context variables.',

  parametersValidator: v.union(
    v.object({
      operation: v.literal('update'),
      fileId: v.string(),
      title: v.optional(v.string()),
      content: v.optional(v.string()),
      mimeType: v.optional(v.string()),
      extension: v.optional(v.string()),
      metadata: v.optional(jsonRecordValidator),
      sourceProvider: v.optional(v.string()),
      contentHash: v.optional(v.string()),
    }),
    v.object({
      operation: v.literal('retrieve'),
      fileId: v.string(),
      chunkStart: v.optional(v.number()),
      chunkEnd: v.optional(v.number()),
      returnChunks: v.optional(v.boolean()),
    }),
    v.object({
      operation: v.literal('generate_docx'),
      fileName: v.string(),
      sourceType: v.union(v.literal('markdown'), v.literal('html')),
      content: v.string(),
    }),
    v.object({
      operation: v.literal('get_metadata'),
      fileIds: v.array(v.string()),
    }),
    v.object({
      operation: v.literal('create'),
      fileId: v.string(),
      title: v.optional(v.string()),
      folderPath: v.optional(v.string()),
      folderPathPrefix: v.optional(v.string()),
      sourceProvider: v.optional(v.string()),
      externalItemId: v.optional(v.string()),
      contentHash: v.optional(v.string()),
      metadata: v.optional(jsonRecordValidator),
      driveId: v.optional(v.string()),
    }),
    v.object({
      operation: v.literal('compare'),
      baseFileId: v.string(),
      comparisonFileId: v.string(),
      baseFileName: v.optional(v.string()),
      comparisonFileName: v.optional(v.string()),
      maxChanges: v.optional(v.number()),
    }),
    v.object({
      operation: v.literal('extract_docx_structured'),
      fileId: v.string(),
    }),
    v.object({
      operation: v.literal('apply_docx_structured'),
      templateFileId: v.string(),
      sourceHash: v.string(),
      modifications: v.array(v.object({ key: v.string(), text: v.string() })),
      fileName: v.string(),
      trackChanges: v.optional(v.boolean()),
      author: v.optional(v.string()),
    }),
    v.object({
      operation: v.literal('list'),
      folderPath: v.optional(v.string()),
      extension: v.optional(v.string()),
    }),
    v.object({
      operation: v.literal('index_in_rag'),
      documentId: v.string(),
    }),
    v.object({
      operation: v.literal('find_by_external_id'),
      externalItemId: v.string(),
      folderPath: v.optional(v.string()),
      folderPathPrefix: v.optional(v.string()),
    }),
    v.object({
      operation: v.literal('reconcile_deletes'),
      sourceProvider: v.string(),
      folderPath: v.string(),
      presentExternalIds: v.array(v.string()),
      driveId: v.optional(v.string()),
      truncated: v.optional(v.boolean()),
    }),
  ),

  async execute(ctx, params, _variables) {
    switch (params.operation) {
      case 'update': {
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;
        const userId =
          typeof _variables.userId === 'string' ? _variables.userId : undefined;

        if (!organizationId) {
          throw new Error(
            'organizationId is required in workflow variables to update a document',
          );
        }

        const document = await ctx.runQuery(
          internal.documents.internal_queries.findDocumentByFileId,
          { organizationId, fileId: params.fileId },
        );

        if (!document) {
          throw new Error(`Document not found for file ID "${params.fileId}"`);
        }

        await assertDocumentAccessibleInWorkflow(
          ctx,
          organizationId,
          userId,
          document,
          params.fileId,
        );

        const documentId = document._id;

        await ctx.runMutation(
          internal.documents.internal_mutations.updateDocument,
          {
            documentId,
            title: params.title,
            content: params.content,
            metadata: params.metadata
              ? toConvexJsonRecord(params.metadata)
              : undefined,
            mimeType: params.mimeType,
            extension: params.extension,
            sourceProvider: params.sourceProvider,
            contentHash: params.contentHash,
          },
        );

        const updatedDocument = await ctx.runQuery(
          internal.documents.internal_queries.getDocumentByIdRaw,
          { documentId },
        );

        if (!updatedDocument) {
          throw new Error(
            `Failed to fetch updated document with file ID "${params.fileId}"`,
          );
        }

        return updatedDocument;
      }

      case 'retrieve': {
        // Cross-org gate: `_variables.organizationId` is set by
        // `initializeExecutionVariables` from `args.organizationId` (which
        // is verified at trigger time). `params.fileId` may flow in from
        // a prior step's output, so we must reject any fileId that does
        // not have a `documents` row in this org. The agent-tool
        // equivalent (`retrieveDocument`) enforces the same gate via
        // `findDocumentByFileId` + `getAccessibleDocumentIds`; the
        // workflow path was missing it.
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;
        const userId =
          typeof _variables.userId === 'string' ? _variables.userId : undefined;
        if (!organizationId) {
          throw new Error(
            'organizationId is required in workflow variables to retrieve a document',
          );
        }
        const ownsDocument = await ctx.runQuery(
          internal.documents.internal_queries.findDocumentByFileId,
          { organizationId, fileId: params.fileId },
        );
        if (!ownsDocument) {
          throw new Error(
            `Document with file ID "${params.fileId}" not found in this organization`,
          );
        }
        await assertDocumentAccessibleInWorkflow(
          ctx,
          organizationId,
          userId,
          ownsDocument,
          params.fileId,
        );
        const retrieveOrgSlug = await orgSlugFromId(ctx, organizationId);
        const result = await fetchDocumentContent(
          retrieveOrgSlug,
          params.fileId,
          {
            chunkStart: params.chunkStart,
            chunkEnd: params.chunkEnd,
            returnChunks: params.returnChunks,
          },
        );
        // Prompt-injection defense for the workflow path. The
        // agent-tool sibling `retrieveDocument` already wraps video-
        // link-sourced content in `<untrusted_source>`; the workflow
        // path was missing it, so attacker-controlled transcript text
        // could reach a downstream LLM step (`step.run`) unwrapped.
        const videoSources = await ctx.runQuery(
          internal.file_metadata.internal_queries.lookupVideoLinkSources,
          { storageIds: [toId<'_storage'>(params.fileId)] },
        );
        if (videoSources.length > 0) {
          const meta: { tool: string; url?: string } = {
            tool: 'document_retrieve',
          };
          if (videoSources[0].sourceUrl) meta.url = videoSources[0].sourceUrl;
          result.content = wrapUntrusted(result.content, meta);
        }
        return result;
      }

      case 'generate_docx': {
        const content = normalizeEscapeSequences(params.content);
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;

        if (!organizationId) {
          throw new Error(
            'organizationId is required in workflow variables to generate a document',
          );
        }

        return await ctx.runAction(
          internal.documents.internal_actions.generateDocument,
          {
            organizationId,
            fileName: params.fileName,
            sourceType: params.sourceType,
            outputFormat: 'docx',
            content,
          },
        );
      }

      case 'compare': {
        // Cross-org gate: same rationale as `retrieve` — workflow params
        // can carry caller-controlled storage ids from upstream steps,
        // and Convex `_storage` is a global namespace. The public
        // `compareDocuments` action enforces this with
        // `verifyStorageIdsBelongToOrg`; the workflow path must too.
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;
        if (!organizationId) {
          throw new Error(
            'organizationId is required in workflow variables to compare documents',
          );
        }
        const ownsStorage = await ctx.runQuery(
          internal.documents.internal_queries.verifyStorageIdsBelongToOrg,
          {
            organizationId,
            storageIds: [params.baseFileId, params.comparisonFileId],
          },
        );
        if (!ownsStorage) {
          throw new Error(
            'One or more storage ids do not belong to this organization',
          );
        }

        const [baseFileUrl, compFileUrl] = await Promise.all([
          resolveStorageUrl(ctx, params.baseFileId),
          resolveStorageUrl(ctx, params.comparisonFileId),
        ]);

        const [baseFileName, compFileName] =
          params.baseFileName && params.comparisonFileName
            ? [params.baseFileName, params.comparisonFileName]
            : await Promise.all([
                resolveFileName(ctx, params.baseFileId),
                resolveFileName(ctx, params.comparisonFileId),
              ]);

        const compareOrgSlug = await orgSlugFromId(ctx, organizationId);
        return await fetchDocumentComparisonByUrls(
          baseFileUrl,
          baseFileName,
          compFileUrl,
          compFileName,
          compareOrgSlug,
          params.maxChanges,
        );
      }

      case 'create': {
        const storageId = toId<'_storage'>(params.fileId);

        const fileMetadata = await ctx.runQuery(
          internal.file_metadata.internal_queries.getByStorageId,
          { storageId },
        );

        if (!fileMetadata) {
          throw new Error(
            `File metadata not found for storage ID "${params.fileId}". The file may not exist.`,
          );
        }

        const docTitle = params.title ?? fileMetadata.fileName;
        // Sync titles are kept clean (no extension), so derive the document's
        // extension from the stored blob's filename (e.g. "Overview.txt" -> "txt").
        const extension =
          extractExtension(fileMetadata.fileName) ?? extractExtension(docTitle);
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;
        const userId =
          typeof _variables.userId === 'string' ? _variables.userId : undefined;

        if (!organizationId) {
          throw new Error(
            'organizationId is required in workflow variables to create a document',
          );
        }

        let folderId: string | null = null;
        if (params.folderPath) {
          folderId = await ctx.runMutation(
            internal.folders.internal_mutations.getOrCreateFolderPath,
            {
              organizationId,
              pathSegments: params.folderPath.split('/').filter(Boolean),
              createdBy: userId,
            },
          );
        }

        const sourceProvider = params.sourceProvider ?? 'agent';

        // Sync flows pass `externalItemId` and rely on dedup. Route through the
        // atomic upsert mutation: a single transaction reads+writes the index,
        // and Convex OCC retries one of two concurrent calls so duplicate rows
        // can't be created. `folderPathPrefix` constrains the cross-folder
        // fallback to a single sync's subtree (prevents two independent syncs
        // from ping-ponging the same external file).
        if (params.externalItemId) {
          const result = await ctx.runMutation(
            internal.documents.internal_mutations.upsertDocumentByExternalId,
            {
              organizationId,
              externalItemId: params.externalItemId,
              folderPathPrefix: params.folderPathPrefix,
              title: docTitle,
              fileId: storageId,
              mimeType: fileMetadata.contentType,
              extension,
              sourceProvider,
              contentHash: params.contentHash,
              metadata: params.metadata,
              driveId: params.driveId,
              ...(folderId ? { folderId: toId<'folders'>(folderId) } : {}),
              createdBy: userId,
            },
          );

          // Back-fill the reverse fileMetadata -> document link. Sync flows
          // store the blob in an earlier step (source 'agent', no documentId),
          // so without this the row matches the retention sweep's orphaned
          // agent-temp-file selector (source 'agent' AND documentId undefined)
          // and its blob + RAG entry can be hard-deleted out from under a live
          // document. A content re-sync may swap to a new storageId, so link
          // the current one on every run. Mirrors the upload/OneDrive paths.
          await ctx.runMutation(
            internal.file_metadata.internal_mutations.linkDocumentToFile,
            { storageId, documentId: result.documentId },
          );

          return {
            success: true,
            fileId: params.fileId,
            title: docTitle,
            folderPath: params.folderPath ?? null,
            documentId: result.documentId,
            action: result.action,
            contentChanged: result.contentChanged,
          };
        }

        // Non-sync ad-hoc create (no externalItemId) — straight insert, no dedup.
        const folderIdPatch = folderId
          ? { folderId: toId<'folders'>(folderId) }
          : {};
        const metadataPatch = params.metadata
          ? { metadata: toConvexJsonRecord(params.metadata) }
          : {};

        const documentId = await ctx.runMutation(
          internal.documents.internal_mutations.createDocument,
          {
            organizationId,
            title: docTitle,
            fileId: storageId,
            mimeType: fileMetadata.contentType,
            extension,
            sourceProvider,
            contentHash: params.contentHash,
            createdBy: userId,
            ...folderIdPatch,
            ...metadataPatch,
          },
        );

        // Back-fill the reverse fileMetadata -> document link (see the upsert
        // branch above) so a connector-stored blob isn't garbage-collected as
        // an orphaned agent temp file.
        await ctx.runMutation(
          internal.file_metadata.internal_mutations.linkDocumentToFile,
          { storageId, documentId },
        );

        return {
          success: true,
          fileId: params.fileId,
          title: docTitle,
          folderPath: params.folderPath ?? null,
          documentId,
          action: 'created',
        };
      }

      case 'get_metadata': {
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;
        const userId =
          typeof _variables.userId === 'string' ? _variables.userId : undefined;

        // Team-ACL gate: load the caller's accessible documentIds once
        // (cheaper than once per fileId) and filter in the per-id loop
        // below. Only applies when both organizationId and userId are
        // known — system-triggered workflows (no userId) get the
        // org-membership gate only, consistent with the other doc ops.
        const accessibleIds: string[] | null =
          organizationId && userId
            ? await ctx.runQuery(
                internal.documents.internal_queries.getAccessibleDocumentIds,
                { organizationId, userId },
              )
            : null;

        const results = await Promise.all(
          params.fileIds.map(async (fileId) => {
            const [fileMetadata, document] = await Promise.all([
              ctx.runQuery(
                internal.file_metadata.internal_queries.getByStorageId,
                { storageId: toId<'_storage'>(fileId) },
              ),
              organizationId
                ? ctx.runQuery(
                    internal.documents.internal_queries.findDocumentByFileId,
                    { organizationId, fileId },
                  )
                : Promise.resolve(undefined),
            ]);

            // Cross-tenant gate: `getByStorageId` is a global `by_storageId`
            // index lookup with no org filter, so a workflow caller can
            // supply a foreign-org `_storage` id and read back its
            // `fileName` unless we gate on `fileMetadata.organizationId`.
            // The sibling branches `extract_docx_structured` /
            // `apply_docx_structured` already enforce this via
            // `verifyStorageIdsBelongToOrg` — mirror that gate here.
            const ownedMetadata =
              fileMetadata &&
              organizationId &&
              fileMetadata.organizationId === organizationId
                ? fileMetadata
                : null;

            // Drop the docs-row if the caller doesn't have access to its
            // team. fileMetadata + base name still surface so workflow
            // steps that only need fileName don't break — but team-
            // private fields (sourceCreatedAt/sourceModifiedAt/
            // lastModified, docMetadata) are gated below.
            const visibleDocument =
              document &&
              (accessibleIds === null || accessibleIds.includes(document._id))
                ? document
                : undefined;

            /* oxlint-disable typescript/no-unsafe-type-assertion -- metadata is a generic JSON record from Convex schema; runtime guard ensures it's an object before narrowing */
            const docMetadata =
              visibleDocument?.metadata != null &&
              typeof visibleDocument.metadata === 'object'
                ? (visibleDocument.metadata as DocumentMetadata)
                : undefined;
            /* oxlint-enable typescript/no-unsafe-type-assertion */

            const lastModified = visibleDocument
              ? getDocumentEffectiveDate(
                  visibleDocument,
                  docMetadata,
                  visibleDocument._creationTime,
                )
              : undefined;

            return {
              fileId,
              fileName: ownedMetadata?.fileName ?? 'Unknown',
              sourceCreatedAt: visibleDocument?.sourceCreatedAt,
              sourceModifiedAt: visibleDocument?.sourceModifiedAt,
              lastModified,
            };
          }),
        );
        return results;
      }

      case 'extract_docx_structured': {
        // Cross-tenant gate: caller-supplied fileId could reference any
        // org's storage; verify ownership before reading.
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;
        if (!organizationId) {
          throw new Error(
            'extract_docx_structured requires organizationId in workflow _variables.',
          );
        }
        const ownsStorage = await ctx.runQuery(
          internal.documents.internal_queries.verifyStorageIdsBelongToOrg,
          { organizationId, storageIds: [params.fileId] },
        );
        if (!ownsStorage) {
          throw new Error('fileId does not belong to this organization');
        }
        return await extractDocxStructured(ctx, params.fileId, organizationId);
      }

      case 'apply_docx_structured': {
        // Cross-tenant gate: templateFileId could reference any org's
        // storage; verify ownership before reading + writing derived
        // output back into the caller's library.
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;
        if (!organizationId) {
          throw new Error(
            'apply_docx_structured requires organizationId in workflow _variables.',
          );
        }
        const ownsTemplate = await ctx.runQuery(
          internal.documents.internal_queries.verifyStorageIdsBelongToOrg,
          { organizationId, storageIds: [params.templateFileId] },
        );
        if (!ownsTemplate) {
          throw new Error(
            'templateFileId does not belong to this organization',
          );
        }

        return await applyDocxStructured(ctx, {
          templateFileId: params.templateFileId,
          sourceHash: params.sourceHash,
          modifications: params.modifications,
          fileName: params.fileName,
          trackChanges: params.trackChanges,
          author: params.author,
          organizationId,
        });
      }

      case 'list': {
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;
        const userId =
          typeof _variables.userId === 'string' ? _variables.userId : undefined;

        if (!organizationId) {
          throw new Error(
            'organizationId is required in workflow variables to list documents',
          );
        }
        if (!userId) {
          throw new Error(
            'userId is required in workflow variables to list documents',
          );
        }

        const allDocuments: Array<{
          fileId: string;
          title: string;
          extension: string | null;
          folderPath: string | null;
          teamId: string | null;
          createdAt: number;
          sizeBytes: number | null;
        }> = [];
        const MAX_TOTAL = 500;
        let cursor: number | undefined;

        while (allDocuments.length < MAX_TOTAL) {
          const batch = await ctx.runQuery(
            internal.documents.internal_queries.listForAgent,
            {
              organizationId,
              userId,
              folderPath: params.folderPath,
              extension: params.extension,
              limit: MAX_LIMIT,
              ...(cursor != null ? { cursor } : {}),
            },
          );

          for (const doc of batch.documents) {
            if (allDocuments.length >= MAX_TOTAL) break;
            allDocuments.push(doc);
          }

          if (!batch.hasMore || batch.cursor == null) break;
          cursor = batch.cursor;
        }

        return {
          documents: allDocuments,
          totalCount: allDocuments.length,
        };
      }

      case 'index_in_rag': {
        // Wraps the canonical RAG indexing flow: upload to RAG service, mark
        // the file's `fileMetadata.ragStatus='queued'`, and schedule status
        // polling (which flips it to 'completed' or 'failed'). Without this
        // wrapper, a workflow that calls `rag.upload_document` directly would
        // push the file to RAG but leave `ragStatus` untouched — so the UI
        // still shows "Not indexed".
        await ctx.runAction(
          internal.documents.internal_actions.uploadDocumentToRag,
          { documentId: toId<'documents'>(params.documentId) },
        );

        return {
          success: true,
          documentId: params.documentId,
        };
      }

      case 'find_by_external_id': {
        // Cheap pre-flight lookup used by sync workflows to skip the download
        // step when the source file's hash hasn't changed. Read-only by design:
        // resolves the folder via a query (no folder rows created) and short-
        // circuits to `exists: false` if the path does not yet exist.
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;

        if (!organizationId) {
          throw new Error(
            'organizationId is required in workflow variables to look up a document',
          );
        }

        let folderId: Id<'folders'> | null = null;
        let folderResolved = true;
        if (params.folderPath) {
          const resolved = await ctx.runQuery(
            internal.folders.internal_queries.findFolderByPath,
            {
              organizationId,
              pathSegments: params.folderPath.split('/').filter(Boolean),
            },
          );
          if (resolved === null) {
            folderResolved = false;
          } else {
            folderId = resolved;
          }
        }

        let existing: Doc<'documents'> | null = null;

        if (folderResolved) {
          const lookupFolderId =
            folderId ?? (params.folderPath ? null : undefined);
          existing = await ctx.runQuery(
            internal.documents.internal_queries.findDocumentByExternalId,
            {
              organizationId,
              externalItemId: params.externalItemId,
              ...(lookupFolderId !== undefined
                ? { folderId: lookupFolderId }
                : {}),
            },
          );
        }

        // Prefix fallback closes the unscoped-first-match hole when
        // `folderPath` is omitted, and lets callers detect cross-folder
        // moves at lookup time when the exact folder lookup misses.
        if (!existing && params.folderPathPrefix) {
          existing = await ctx.runQuery(
            internal.documents.internal_queries.findDocumentByExternalId,
            {
              organizationId,
              externalItemId: params.externalItemId,
              folderPathPrefix: params.folderPathPrefix,
            },
          );
        }

        if (!existing) {
          return { exists: false };
        }

        return {
          exists: true,
          documentId: existing._id,
          contentHash: existing.contentHash,
          externalItemId: existing.externalItemId,
          fileId: existing.fileId,
          title: existing.title,
          folderPath: existing.folderPath,
        };
      }

      case 'reconcile_deletes': {
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;

        if (!organizationId) {
          throw new Error(
            'organizationId is required in workflow variables to reconcile deletes',
          );
        }

        // Defense-in-depth: a truncated upstream listing means the present-id
        // set is incomplete and reconcile would delete legitimate docs. The
        // workflow JSON should already gate this step on a truncation check;
        // enforce it here too so a forked workflow without that gate is safe.
        if (params.truncated) {
          return {
            success: false,
            deleted: 0,
            scanned: params.presentExternalIds.length,
            skippedReason: `Skipping reconcile: ${params.sourceProvider} listing was truncated (present-id set incomplete).`,
          };
        }

        const orphaned = await ctx.runQuery(
          internal.documents.internal_queries.listOrphanedExternalDocs,
          {
            organizationId,
            sourceProvider: params.sourceProvider,
            folderPathPrefix: params.folderPath,
            presentExternalIds: params.presentExternalIds,
            driveId: params.driveId,
          },
        );

        // Empty present set + non-empty orphan candidates means the source
        // listing very likely failed silently (Drive returns 200+empty for
        // OAuth scope downgrades, lost shared-drive access, or wrong folder
        // ids). Always skip in this case — a user who really wants to clear
        // the target can do so directly in the Tale UI.
        if (params.presentExternalIds.length === 0 && orphaned.length > 0) {
          return {
            success: false,
            deleted: 0,
            scanned: 0,
            skippedReason: `Skipping reconcile: ${params.sourceProvider} listing returned 0 files for "${params.folderPath}". ${orphaned.length} documents preserved as a safety against transient source-side failures.`,
          };
        }

        // Mass-delete sanity bound: a Drive folder narrowed by permissions
        // or mime-filter can return a small-but-non-empty listing that
        // would silently delete every other doc under the prefix. Abort
        // when more than half (and >20 absolute) would be deleted.
        const scanned = params.presentExternalIds.length;
        const MAX_DELETE_ABS = 20;
        const MAX_DELETE_RATIO = 0.5;
        if (
          orphaned.length > MAX_DELETE_ABS &&
          orphaned.length > scanned * MAX_DELETE_RATIO
        ) {
          return {
            success: false,
            deleted: 0,
            scanned,
            skippedReason: `Skipping reconcile: ${orphaned.length} orphans vs ${scanned} present — exceeds safety bound (>${MAX_DELETE_ABS} and >${Math.round(MAX_DELETE_RATIO * 100)}% of scanned).`,
          };
        }

        // Resolve the sync target root so per-doc deletes can reap their
        // now-empty ancestor folders without ever crossing this boundary.
        // Read-only — never create folders during a delete pass. Missing
        // root → skip cleanup (no orphans should exist either).
        const rootPathSegments = params.folderPath
          .split('/')
          .filter((s: string) => s.trim().length > 0);
        const cleanupAncestorsUpTo: Id<'folders'> | undefined =
          rootPathSegments.length > 0
            ? ((await ctx.runQuery(
                internal.folders.internal_queries.findFolderByPath,
                {
                  organizationId,
                  pathSegments: rootPathSegments,
                },
              )) ?? undefined)
            : undefined;

        // Operator audit trail: one line per scheduled delete so the
        // affected docs can be identified and (if needed) restored from
        // backup. Keep individual log lines so they survive log rotation
        // by id rather than depending on one giant payload.
        for (const doc of orphaned) {
          console.warn(
            `[reconcile_deletes] Scheduling delete documentId=${doc.documentId} externalItemId=${doc.externalItemId} title=${JSON.stringify(doc.title ?? null)} sourceProvider=${params.sourceProvider}`,
          );
        }

        // Stagger deletes by 100ms to avoid swamping the scheduler and the
        // RAG service when a folder churns. deleteDocumentFromRag's own
        // backoff still applies on top.
        //
        // Snapshot-and-verify: pass `expectedExternalItemId` / `expectedFileId`
        // into the scheduled args so a doc re-bound by an interleaving
        // upsert (e.g. restore-during-pending-reconcile) is not deleted.
        for (let i = 0; i < orphaned.length; i++) {
          const doc = orphaned[i];
          if (doc.fileId) {
            await ctx.scheduler.runAfter(
              i * 100,
              internal.documents.internal_actions.deleteDocumentFromRag,
              {
                documentId: doc.documentId,
                expectedExternalItemId: doc.externalItemId,
                expectedFileId: doc.fileId,
                cleanupAncestorsUpTo,
              },
            );
          } else {
            await ctx.scheduler.runAfter(
              i * 100,
              internal.documents.internal_mutations.deleteDocumentById,
              {
                documentId: doc.documentId,
                cleanupAncestorsUpTo,
              },
            );
          }
        }

        return {
          success: true,
          deleted: orphaned.length,
          scanned,
        };
      }

      default:
        throw new Error(
          `Unsupported document operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
