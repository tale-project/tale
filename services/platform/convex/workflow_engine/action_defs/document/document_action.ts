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
import type { ActionDefinition } from '../../helpers/nodes/action/types';

import { internal } from '../../../_generated/api';
import { fetchDocumentContent } from '../../../agent_tools/documents/helpers/fetch_document_content';
import { getRagConfig } from '../../../lib/helpers/rag_config';
import { toConvexJsonRecord } from '../../../lib/type_cast_helpers';
import { jsonRecordValidator } from '../../../lib/validators/json';

type DocumentActionParams =
  | {
      operation: 'update';
      documentId: Id<'documents'>;
      title?: string;
      content?: string;
      fileId?: Id<'_storage'>;
      mimeType?: string;
      extension?: string;
      metadata?: Record<string, unknown>;
      sourceProvider?: 'onedrive' | 'upload';
    }
  | {
      operation: 'retrieve';
      documentId: string;
      chunkStart?: number;
      chunkEnd?: number;
      returnChunks?: boolean;
    }
  | {
      operation: 'generate_docx';
      fileName: string;
      sourceType: 'markdown' | 'html';
      content: string;
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
      fileId: v.optional(v.id('_storage')),
      mimeType: v.optional(v.string()),
      extension: v.optional(v.string()),
      metadata: v.optional(jsonRecordValidator),
      sourceProvider: v.optional(
        v.union(v.literal('onedrive'), v.literal('upload')),
      ),
    }),
    v.object({
      operation: v.literal('retrieve'),
      documentId: v.string(),
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
  ),

  async execute(ctx, params, variables) {
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
            fileId: params.fileId,
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
        const organizationId =
          typeof variables.organizationId === 'string'
            ? variables.organizationId
            : undefined;
        const userId =
          typeof variables.userId === 'string' ? variables.userId : undefined;

        if (!organizationId || !userId) {
          throw new Error(
            'organizationId and userId are required in workflow variables for document retrieve',
          );
        }

        const accessibleIds: string[] = await ctx.runQuery(
          internal.documents.internal_queries.getAccessibleDocumentIds,
          { organizationId, userId },
        );

        if (!accessibleIds.includes(params.documentId)) {
          throw new Error(
            `Document not found or access denied: "${params.documentId}"`,
          );
        }

        const { serviceUrl } = getRagConfig();
        return await fetchDocumentContent(serviceUrl, params.documentId, {
          chunkStart: params.chunkStart,
          chunkEnd: params.chunkEnd,
          returnChunks: params.returnChunks,
        });
      }

      case 'generate_docx': {
        return await ctx.runAction(
          internal.documents.internal_actions.generateDocument,
          {
            fileName: params.fileName,
            sourceType: params.sourceType,
            outputFormat: 'docx',
            content: params.content,
          },
        );
      }

      default:
        throw new Error(
          `Unsupported document operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
