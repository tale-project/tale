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

import type { ActionCtx } from '../../../_generated/server';
import type { DocumentMetadata } from '../../../documents/types';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

import { internal } from '../../../_generated/api';
import { fetchDocumentComparisonByUrls } from '../../../agent_tools/documents/helpers/fetch_document_comparison';
import { fetchDocumentContent } from '../../../agent_tools/documents/helpers/fetch_document_content';
import { getDocumentEffectiveDate } from '../../../documents/transform_to_document_item';
import { getRagConfig } from '../../../lib/helpers/rag_config';
import { toConvexJsonRecord, toId } from '../../../lib/type_cast_helpers';
import { jsonRecordValidator } from '../../../lib/validators/json';
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
      sourceProvider?: 'onedrive' | 'upload';
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
    };

export const documentAction: ActionDefinition<DocumentActionParams> = {
  type: 'document',
  title: 'Document Operation',
  description:
    'Execute document-specific operations (list, update, retrieve, generate_docx, create, extract_docx_structured, apply_docx_structured). organizationId is automatically read from workflow context variables.',

  parametersValidator: v.union(
    v.object({
      operation: v.literal('update'),
      fileId: v.string(),
      title: v.optional(v.string()),
      content: v.optional(v.string()),
      mimeType: v.optional(v.string()),
      extension: v.optional(v.string()),
      metadata: v.optional(jsonRecordValidator),
      sourceProvider: v.optional(
        v.union(v.literal('onedrive'), v.literal('upload')),
      ),
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
  ),

  async execute(ctx, params, _variables) {
    switch (params.operation) {
      case 'update': {
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;

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
        const { serviceUrl } = getRagConfig();
        return await fetchDocumentContent(serviceUrl, params.fileId, {
          chunkStart: params.chunkStart,
          chunkEnd: params.chunkEnd,
          returnChunks: params.returnChunks,
        });
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
        const { serviceUrl } = getRagConfig();

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

        return await fetchDocumentComparisonByUrls(
          serviceUrl,
          baseFileUrl,
          baseFileName,
          compFileUrl,
          compFileName,
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

        await ctx.runMutation(
          internal.documents.internal_mutations.createDocument,
          {
            organizationId,
            title: docTitle,
            fileId: storageId,
            mimeType: fileMetadata.contentType,
            sourceProvider: 'agent',
            createdBy: userId,
            ...(folderId ? { folderId: toId<'folders'>(folderId) } : {}),
          },
        );

        return {
          success: true,
          fileId: params.fileId,
          title: docTitle,
          folderPath: params.folderPath ?? null,
        };
      }

      case 'get_metadata': {
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;

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

            /* oxlint-disable typescript/no-unsafe-type-assertion -- metadata is a generic JSON record from Convex schema; runtime guard ensures it's an object before narrowing */
            const docMetadata =
              document?.metadata != null &&
              typeof document.metadata === 'object'
                ? (document.metadata as DocumentMetadata)
                : undefined;
            /* oxlint-enable typescript/no-unsafe-type-assertion */

            const lastModified = document
              ? getDocumentEffectiveDate(
                  document,
                  docMetadata,
                  document._creationTime,
                )
              : undefined;

            return {
              fileId,
              fileName: fileMetadata?.fileName ?? 'Unknown',
              sourceCreatedAt: document?.sourceCreatedAt,
              sourceModifiedAt: document?.sourceModifiedAt,
              lastModified,
            };
          }),
        );
        return results;
      }

      case 'extract_docx_structured': {
        return await extractDocxStructured(ctx, params.fileId);
      }

      case 'apply_docx_structured': {
        const organizationId =
          typeof _variables.organizationId === 'string'
            ? _variables.organizationId
            : undefined;

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

      default:
        throw new Error(
          `Unsupported document operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
