/**
 * Import Files Dependencies - Factory for creating importFiles dependencies
 */

import type { ActionCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { getFileMetadata } from './get_file_metadata';
import { downloadFile } from './download_file';
import type { ImportFilesDependencies } from './import_files';

/**
 * Create dependencies for the importFiles function.
 * Binds Convex context to the dependency functions.
 */
export function createImportFilesDeps(ctx: ActionCtx): ImportFilesDependencies {
  return {
    getFileMetadata: (itemId, token, siteId, driveId) =>
      getFileMetadata(itemId, token, siteId, driveId),
    downloadFile: (itemId, token, siteId, driveId) =>
      downloadFile(itemId, token, siteId, driveId),
    findDocumentByExternalId: async (findArgs) => {
      const doc = await ctx.runQuery(
        internal.documents.internal_queries.findDocumentByExternalId,
        findArgs,
      );
      return doc ? { _id: doc._id, contentHash: doc.contentHash } : null;
    },
    storeFile: async (blob) => ctx.storage.store(blob),
    createDocument: async (createArgs) =>
      ctx.runMutation(internal.documents.internal_mutations.createDocument, createArgs),
    updateDocument: async (updateArgs) => {
      await ctx.runMutation(internal.documents.internal_mutations.updateDocument, updateArgs);
    },
  };
}
