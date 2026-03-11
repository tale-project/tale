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

import type { Id } from '../../../_generated/dataModel';
import type { ActionCtx } from '../../../_generated/server';
import type { ActionDefinition } from '../../helpers/nodes/action/types';

import { internal } from '../../../_generated/api';
import { fetchDocumentComparisonByUrls } from '../../../agent_tools/documents/helpers/fetch_document_comparison';
import { fetchDocumentContent } from '../../../agent_tools/documents/helpers/fetch_document_content';
import { getRagConfig } from '../../../lib/helpers/rag_config';
import { toConvexJsonRecord, toId } from '../../../lib/type_cast_helpers';
import { jsonRecordValidator } from '../../../lib/validators/json';

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
      documentId: Id<'documents'>;
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
    };

export const documentAction: ActionDefinition<DocumentActionParams> = {
  type: 'document',
  title: 'Document Operation',
  description:
    'Execute document-specific operations (update, retrieve, generate_docx). organizationId is automatically read from workflow context variables.',

  parametersValidator: v.union(
    v.object({
      operation: v.literal('update'),
      documentId: v.id('documents'),
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
      operation: v.literal('compare'),
      baseFileId: v.string(),
      comparisonFileId: v.string(),
      baseFileName: v.optional(v.string()),
      comparisonFileName: v.optional(v.string()),
      maxChanges: v.optional(v.number()),
    }),
  ),

  async execute(ctx, params, _variables) {
    switch (params.operation) {
      case 'update': {
        const documentId = params.documentId;

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
            `Failed to fetch updated document with ID "${documentId}"`,
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

        return await ctx.runAction(
          internal.documents.internal_actions.generateDocument,
          {
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

      case 'get_metadata': {
        const results = await Promise.all(
          params.fileIds.map(async (fileId) => {
            const metadata = await ctx.runQuery(
              internal.file_metadata.internal_queries.getByStorageId,
              { storageId: toId<'_storage'>(fileId) },
            );
            return {
              fileId,
              fileName: metadata?.fileName ?? 'Unknown',
            };
          }),
        );
        return results;
      }

      default:
        throw new Error(
          `Unsupported document operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
