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

// Type for document operation params (discriminated union)
type DocumentActionParams = {
  operation: 'update';
  documentId: Id<'documents'>;
  title?: string;
  content?: string;
  fileId?: Id<'_storage'>;
  mimeType?: string;
  extension?: string;
  metadata?: Record<string, unknown>;
  sourceProvider?: 'onedrive' | 'upload';
};

export const documentAction: ActionDefinition<DocumentActionParams> = {
  type: 'document',
  title: 'Document Operation',
  description:
    'Execute document-specific operations (update). organizationId is automatically read from workflow context variables.',
  // update: Update a document by ID
  parametersValidator: v.object({
    operation: v.literal('update'),
    documentId: v.id('documents'),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    fileId: v.optional(v.id('_storage')),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
    metadata: v.optional(v.any()),
    sourceProvider: v.optional(
      v.union(v.literal('onedrive'), v.literal('upload')),
    ),
  }),
  async execute(ctx, params, _variables) {
    switch (params.operation) {
      case 'update': {
        // Extract documentId to avoid duplicate type assertion
        const documentId = params.documentId as Id<'documents'>;

        await ctx.runMutation!(internal.mutations.documents.updateDocumentInternal, {
          documentId, // Required by validator
          title: params.title,
          content: params.content,
          metadata: params.metadata,
          fileId: params.fileId as Id<'_storage'> | undefined,
          mimeType: params.mimeType,
          extension: params.extension,
          sourceProvider: params.sourceProvider,
        });

        // Fetch and return the updated entity
        const updatedDocument = await ctx.runQuery!(
          internal.queries.documents.getDocumentById,
          { documentId },
        );

        if (!updatedDocument) {
          throw new Error(
            `Failed to fetch updated document with ID "${documentId}"`,
          );
        }

        // Note: execute_action_node wraps this in output: { type: 'action', data: result }
        return updatedDocument;
      }

      default:
        throw new Error(
          `Unsupported document operation: ${(params as { operation: string }).operation}`,
        );
    }
  },
};
