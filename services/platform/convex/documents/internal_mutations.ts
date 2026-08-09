import { ConvexError, v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import { cleanupEmptyAncestorFolders } from '../folders/cleanup_empty_ancestors';
import { eraseDocumentBlobs } from '../governance/erase_document_blobs';
import { assertNotHeld } from '../governance/legal_hold_guard';
import { blobRefValidator } from '../lib/storage/blob_ref';
import { assertRecordTrashable } from './access';
import { createDocument as createDocumentHelper } from './create_document';
import { scheduleHubDocumentRagIndexing as scheduleHubDocumentRagIndexingImpl } from './schedule_hub_document_rag_indexing';
import { updateDocumentInternal as updateDocumentInternalHelper } from './update_document_internal';
import { upsertDocumentByExternalId as upsertDocumentByExternalIdHelper } from './upsert_document_by_external_id';
import { sourceProviderValidator } from './validators';

export const updateDocument = internalMutation({
  args: {
    documentId: v.id('documents'),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
    fileId: v.optional(blobRefValidator),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
    sourceProvider: v.optional(sourceProviderValidator),
    externalItemId: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    teamId: v.optional(v.string()),
    folderId: v.optional(v.id('folders')),
    /**
     * Caller's organizationId — closes the cross-tenant write IDOR on
     * REST `PATCH /api/v1/documents/:id`. Optional for in-process
     * callers; REST handlers MUST pass this.
     */
    callerOrgId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.callerOrgId !== undefined) {
      const existing = await ctx.db.get(args.documentId);
      if (!existing || existing.organizationId !== args.callerOrgId) {
        // Cross-org or missing — surface as not_found so REST returns 404
        // instead of silently 204'ing the caller into thinking the patch
        // succeeded. Existence is already gated by `callerOrgId`, so this
        // does not leak document presence across tenants.
        throw new ConvexError({
          code: 'not_found',
          message: 'Document not found',
        });
      }
    }
    const { callerOrgId: _drop, ...rest } = args;
    await updateDocumentInternalHelper(ctx, rest);
  },
});

export const deleteDocumentById = internalMutation({
  args: {
    documentId: v.id('documents'),
    /**
     * Caller's organizationId — closes the cross-tenant DELETE IDOR
     * on REST `DELETE /api/v1/documents/:id`. Optional for in-process
     * callers (retention sweep, workflow); REST handlers MUST pass this.
     */
    callerOrgId: v.optional(v.string()),
    /**
     * Sync-reconcile only: after the row is deleted, walk up from the
     * doc's `folderId` and remove ancestor folders that became empty,
     * stopping at (and never deleting) this id (the sync target root).
     * Omit for user-initiated deletes — folder reaping is opt-in.
     */
    cleanupAncestorsUpTo: v.optional(v.id('folders')),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (document) {
      if (
        args.callerOrgId !== undefined &&
        document.organizationId !== args.callerOrgId
      ) {
        return null;
      }
      // Controlled-record gate for EXTERNALLY-attributed deletes (REST
      // passes `callerOrgId`): an in_review/approved record refuses. The
      // in-process callers (retention Pass-B on already-trashed rows, GDPR
      // erasure) stay open — erasure is a legal right that outranks the
      // record workflow, and retention only ever sees rows the trash gates
      // let through.
      if (args.callerOrgId !== undefined) {
        assertRecordTrashable(document);
      }
      // Defense-in-depth: every public/REST/internal caller flows through
      // here; gating at this single point covers the surfaces flagged in
      // round-2 v08 B4. Retention has its own held-aware path.
      //
      // Pass `document.createdBy` so the user-membership cascade fires on
      // the document's author the same way the public `deleteDocument`
      // does. Without this, an internal cascade or REST delete bypasses
      // the custodian-hold cascade. (Round-2 V3 finding.)
      await assertNotHeld(
        ctx,
        document.organizationId,
        'document',
        String(args.documentId),
        undefined,
        document.createdBy ?? undefined,
      );
      const { fileId } = document;
      if (fileId) {
        const metadata = await ctx.db
          .query('fileMetadata')
          .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
          .first();
        if (metadata?.documentId === args.documentId) {
          await ctx.db.patch(metadata._id, { documentId: undefined });
        }
      }
      // Erase _storage blob (primary `fileId` + every `historyFiles[]`)
      // before dropping the row. Pre-fix, the public delete + REST DELETE
      // path only patched the documents row out and unlinked
      // fileMetadata, leaving every blob the row pointed at orphaned in
      // _storage forever — both the storage cost and the unreachable-blob
      // privacy risk. The retention path was already correct via the
      // helper. Round-2 review CRITICAL #18.
      const folderIdBeforeDelete = document.folderId;
      const organizationId = document.organizationId;
      await eraseDocumentBlobs(ctx, document);
      await ctx.db.delete(args.documentId);

      if (args.cleanupAncestorsUpTo && folderIdBeforeDelete) {
        await cleanupEmptyAncestorFolders(
          ctx,
          folderIdBeforeDelete,
          args.cleanupAncestorsUpTo,
          organizationId,
        );
      }
    }
    return null;
  },
});

export const updateDocumentDates = internalMutation({
  args: {
    documentId: v.id('documents'),
    sourceCreatedAt: v.optional(v.number()),
    sourceModifiedAt: v.optional(v.number()),
    scannedPagesDetected: v.optional(v.number()),
    ocrApplied: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      return null;
    }

    const patch: Record<string, unknown> = {};
    if (args.sourceCreatedAt != null) {
      patch.sourceCreatedAt = args.sourceCreatedAt;
    }
    if (args.sourceModifiedAt != null) {
      patch.sourceModifiedAt = args.sourceModifiedAt;
    }
    if (args.scannedPagesDetected != null) {
      patch.scannedPagesDetected = args.scannedPagesDetected;
    }
    if (args.ocrApplied != null) {
      patch.ocrApplied = args.ocrApplied;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.documentId, patch);
    }

    return null;
  },
});

export const createDocument = internalMutation({
  args: {
    organizationId: v.string(),
    title: v.string(),
    content: v.optional(v.string()),
    fileId: v.optional(blobRefValidator),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
    sourceProvider: v.optional(sourceProviderValidator),
    externalItemId: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
    teamId: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    folderId: v.optional(v.id('folders')),
  },
  returns: v.id('documents'),
  handler: async (ctx, args) => {
    const result = await createDocumentHelper(ctx, args);
    return result.documentId;
  },
});

export const upsertDocumentByExternalId = internalMutation({
  args: {
    organizationId: v.string(),
    externalItemId: v.string(),
    folderPathPrefix: v.optional(v.string()),
    title: v.string(),
    fileId: v.optional(blobRefValidator),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
    sourceProvider: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
    folderId: v.optional(v.id('folders')),
    createdBy: v.optional(v.string()),
    /** Connector identifier stamped on the row so reconcile can scope
     * orphan detection per-connector (lets two Drive connectors in
     * one org coexist under the same `folderPathPrefix`). */
    driveId: v.optional(v.string()),
  },
  returns: v.object({
    documentId: v.id('documents'),
    action: v.union(
      v.literal('created'),
      v.literal('updated'),
      v.literal('skipped'),
    ),
    contentChanged: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return await upsertDocumentByExternalIdHelper(ctx, args);
  },
});

export const scheduleHubDocumentRagIndexing = internalMutation({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await scheduleHubDocumentRagIndexingImpl(ctx, args);
  },
});
