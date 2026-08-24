import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { getFileMetadata } from './get_file_metadata';
import type { ImportFilesDependencies } from './import_files';

export function createImportFilesDeps(
  ctx: ActionCtx,
  organizationId: string,
): ImportFilesDependencies {
  return {
    getFileMetadata: (itemId, token) => getFileMetadata(itemId, token),
    downloadToStorage: (streamArgs) =>
      ctx.runAction(
        internal.google_drive.internal_actions.streamItemToStorage,
        {
          ...streamArgs,
          organizationId,
        },
      ),
    findDocumentByExternalId: async (findArgs) => {
      const doc = await ctx.runQuery(
        internal.documents.internal_queries.findDocumentByExternalId,
        findArgs,
      );
      return doc ? { _id: doc._id, contentHash: doc.contentHash } : null;
    },
    createDocument: async (createArgs) =>
      ctx.runMutation(
        internal.documents.internal_mutations.createDocument,
        createArgs,
      ),
    updateDocument: async (updateArgs) => {
      await ctx.runMutation(
        internal.documents.internal_mutations.updateDocument,
        updateArgs,
      );
    },
    getOrCreateFolderPath: async (orgId, pathSegments, createdBy, teamId) =>
      (await ctx.runMutation(
        internal.folders.internal_mutations.getOrCreateFolderPath,
        { organizationId: orgId, pathSegments, createdBy, teamId },
      )) ?? undefined,
    saveFileMetadata: async (
      storageId,
      fileName,
      contentType,
      size,
      documentId,
    ) => {
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.saveFileMetadata,
        {
          organizationId,
          storageId,
          fileName,
          contentType,
          size,
          documentId,
          deferRagDispatch: true,
          source: 'user',
        },
      );
    },
    linkDocumentToFile: async (storageId, documentId) => {
      await ctx.runMutation(
        internal.file_metadata.internal_mutations.linkDocumentToFile,
        { storageId, documentId },
      );
    },
    scheduleHubDocumentRagIndexing: async (documentId) => {
      await ctx.runMutation(
        internal.documents.internal_mutations.scheduleHubDocumentRagIndexing,
        { documentId },
      );
    },
    upsertSyncConfig: async (target) => {
      const result = await ctx.runMutation(
        internal.google_drive.internal_mutations.upsertSyncConfig,
        target,
      );
      return result.configId ?? null;
    },
  };
}
