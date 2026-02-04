/**
 * Upload and Create Document Dependencies - Factory for creating dependencies
 */

import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { UploadAndCreateDocDependencies } from './upload_and_create_document';

/**
 * Create dependencies for the uploadAndCreateDocument function.
 */
export function createUploadAndCreateDocDeps(ctx: ActionCtx): UploadAndCreateDocDependencies {
  return {
    storageStore: async (blob) => ctx.storage.store(blob),
    createDocument: async (args) => {
      const documentId = await ctx.runMutation(
        internal.documents.mutations.createDocumentInternal,
        {
          organizationId: args.organizationId,
          title: args.title,
          fileId: args.fileId,
          sourceProvider: args.sourceProvider,
          metadata: args.metadata,
          createdBy: args.createdBy,
        },
      );
      return { documentId };
    },
    updateDocument: async (args) => {
      await ctx.runMutation(internal.documents.mutations.updateDocumentInternal, {
        documentId: args.documentId,
        title: args.title,
        fileId: args.fileId,
        metadata: args.metadata,
      });
    },
  };
}
