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
import type { ActionDefinition } from '../../helpers/nodes/action/types';
import { internal } from '../../../_generated/api';
import type { Id } from '../../../_generated/dataModel';

// Type definitions for document operations
type CreateDocumentResult = {
  success: boolean;
  documentId: Id<'documents'>;
};

type QueryResult<T = unknown> = {
  page: T[];
  isDone: boolean;
  continueCursor: string | null;
  count: number;
};

type GenerateSignedUrlResult =
  | {
      success: true;
      url: string;
    }
  | {
      success: false;
      error: string;
    };

export const documentAction: ActionDefinition<{
  operation:
    | 'create'
    | 'get_by_id'
    | 'query'
    | 'update'
    | 'generate_signed_url';
  documentId?: string;
  organizationId?: string;
  title?: string;

  content?: string;
  fileId?: string;
  metadata?: Record<string, unknown>;
  sourceProvider?: 'onedrive' | 'upload';

  updates?: Record<string, unknown>;
  paginationOpts?: {
    numItems: number;
    cursor: string | null;
  };
}> = {
  type: 'document',
  title: 'Document Operation',
  description:
    'Execute document-specific operations (create, get_by_id, query, update, generate_signed_url)',
  parametersValidator: v.object({
    operation: v.union(
      v.literal('create'),
      v.literal('get_by_id'),
      v.literal('query'),
      v.literal('update'),
      v.literal('generate_signed_url'),
    ),
    documentId: v.optional(v.id('documents')),
    organizationId: v.optional(v.string()),
    title: v.optional(v.string()),

    content: v.optional(v.string()),
    fileId: v.optional(v.id('_storage')),
    metadata: v.optional(v.any()),
    sourceProvider: v.optional(
      v.union(v.literal('onedrive'), v.literal('upload')),
    ),
    updates: v.optional(v.any()),
    paginationOpts: v.optional(
      v.object({
        numItems: v.number(),
        cursor: v.union(v.string(), v.null()),
      }),
    ),
  }),
  async execute(ctx, params) {
    switch (params.operation) {
      case 'create': {
        if (!params.organizationId) {
          throw new Error('create operation requires organizationId parameter');
        }

        const result = (await ctx.runMutation!(
          internal.documents.createDocument,
          {
            organizationId: params.organizationId,
            title: params.title,
            content: params.content,
            fileId: params.fileId as Id<'_storage'> | undefined,
            metadata: params.metadata,
            sourceProvider: params.sourceProvider,
          },
        )) as CreateDocumentResult;

        return {
          operation: 'create',
          documentId: result.documentId,
          success: result.success,
          timestamp: Date.now(),
        };
      }

      case 'get_by_id': {
        if (!params.documentId) {
          throw new Error('get_by_id operation requires documentId parameter');
        }

        const document = await ctx.runQuery!(
          internal.documents.getDocumentById,
          {
            documentId: params.documentId as Id<'documents'>,
          },
        );

        return {
          operation: 'get_by_id',
          result: document,
          found: document !== null,
          timestamp: Date.now(),
        };
      }

      case 'query': {
        if (!params.organizationId) {
          throw new Error('query operation requires organizationId parameter');
        }

        if (!params.paginationOpts) {
          throw new Error('query operation requires paginationOpts parameter');
        }

        const result = (await ctx.runQuery!(internal.documents.queryDocuments, {
          organizationId: params.organizationId,
          sourceProvider: params.sourceProvider,
          paginationOpts: params.paginationOpts,
        })) as QueryResult;

        return {
          operation: 'query',
          page: result.page,
          isDone: result.isDone,
          continueCursor: result.continueCursor,
          count: result.count,
          timestamp: Date.now(),
        };
      }

      case 'update': {
        if (!params.documentId) {
          throw new Error('update operation requires documentId parameter');
        }

        await ctx.runMutation!(internal.documents.updateDocumentInternal, {
          documentId: params.documentId as Id<'documents'>,
          title: params.title,
          content: params.content,
          metadata: params.metadata,
          fileId: params.fileId as Id<'_storage'> | undefined,
          sourceProvider: params.sourceProvider,
        });

        const updatedId = params.documentId as Id<'documents'>;

        return {
          operation: 'update',
          updatedCount: 1,
          updatedIds: [updatedId],
          success: true,
          timestamp: Date.now(),
        };
      }

      case 'generate_signed_url': {
        if (!params.documentId) {
          throw new Error(
            'generate_signed_url operation requires documentId parameter',
          );
        }

        const result = (await ctx.runQuery!(
          internal.documents.generateSignedUrl,
          {
            documentId: params.documentId as Id<'documents'>,
          },
        )) as GenerateSignedUrlResult;

        if (!result.success) {
          throw new Error(result.error);
        }

        return {
          operation: 'generate_signed_url',
          url: result.url,
          success: true,
          timestamp: Date.now(),
        };
      }

      default:
        throw new Error(
          `Unsupported document operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
