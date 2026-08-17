'use node';

/**
 * Upload and Create Document Dependencies - Factory for creating dependencies.
 * `'use node'`: routes stored bytes through the per-org blob seam (`putBlob`),
 * which signs S3 requests + reads config — node-only. Imported only by the
 * `'use node'` OneDrive internal actions.
 */

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { orgSlugFromIdOrNull } from '../lib/helpers/org_slug';
import { putBlob } from '../lib/storage/blob_access';
import type { UploadAndCreateDocDependencies } from './upload_and_create_document';

/**
 * Create dependencies for the uploadAndCreateDocument function.
 */
export function createUploadAndCreateDocDeps(
  ctx: ActionCtx,
  organizationId: string,
): UploadAndCreateDocDependencies {
  return {
    storageStore: async (blob) => {
      // Route the bytes to the org's own bucket when configured, else Convex
      // `_storage`. An unresolvable org must not fail the import — fall back to
      // `_storage` (the backfill relocates it later). The blob is already fully
      // buffered (it arrived as an action `v.bytes()` arg), so `putBlob` adds
      // no memory ceiling beyond what the caller already paid.
      const orgSlug = await orgSlugFromIdOrNull(ctx, organizationId);
      if (orgSlug === null) {
        return await ctx.storage.store(blob);
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return await putBlob(
        ctx,
        orgSlug,
        bytes,
        blob.type || 'application/octet-stream',
      );
    },
    createDocument: async (args) => {
      const documentId = await ctx.runMutation(
        internal.documents.internal_mutations.createDocument,
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
      await ctx.runMutation(
        internal.documents.internal_mutations.updateDocument,
        {
          documentId: args.documentId,
          title: args.title,
          fileId: args.fileId,
          metadata: args.metadata,
        },
      );
    },
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
          // Index after link so uploadDocumentToRag sees folderPath + source;
          // `scheduleHubDocumentRagIndexing` below honours the promise.
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
  };
}
