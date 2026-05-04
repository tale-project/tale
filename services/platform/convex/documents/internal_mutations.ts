import { ConvexError, v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import { eraseDocumentBlobs } from '../governance/erase_document_blobs';
import { assertNotHeld } from '../governance/legal_hold_guard';
import { createDocument as createDocumentHelper } from './create_document';
import { updateDocumentInternal as updateDocumentInternalHelper } from './update_document_internal';
import { updateDocumentRagInfo as updateDocumentRagInfoHelper } from './update_document_rag_info';
import { upsertDocumentByExternalId as upsertDocumentByExternalIdHelper } from './upsert_document_by_external_id';
import { sourceProviderValidator, ragInfoValidator } from './validators';

export const updateDocument = internalMutation({
  args: {
    documentId: v.id('documents'),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
    fileId: v.optional(v.id('_storage')),
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

export const updateDocumentRagInfo = internalMutation({
  args: {
    documentId: v.id('documents'),
    ragInfo: ragInfoValidator,
  },
  handler: async (ctx, args) => {
    await updateDocumentRagInfoHelper(ctx, args);
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
      await eraseDocumentBlobs(ctx, document);
      await ctx.db.delete(args.documentId);
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

export const backfillIndexedField = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    processed: v.number(),
    updated: v.number(),
    cursor: v.union(v.string(), v.null()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 500;
    let updated = 0;

    const result = await ctx.db
      .query('documents')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    for (const doc of result.page) {
      const shouldBeIndexed = doc.ragInfo?.status === 'completed';
      if (doc.indexed !== shouldBeIndexed) {
        await ctx.db.patch(doc._id, { indexed: shouldBeIndexed });
        updated++;
      }
    }

    return {
      processed: result.page.length,
      updated,
      cursor: result.continueCursor,
      done: result.isDone,
    };
  },
});

export const createDocument = internalMutation({
  args: {
    organizationId: v.string(),
    title: v.string(),
    content: v.optional(v.string()),
    fileId: v.optional(v.id('_storage')),
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
    fileId: v.optional(v.id('_storage')),
    mimeType: v.optional(v.string()),
    sourceProvider: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
    folderId: v.optional(v.id('folders')),
    createdBy: v.optional(v.string()),
  },
  returns: v.object({
    documentId: v.id('documents'),
    action: v.union(
      v.literal('created'),
      v.literal('updated'),
      v.literal('skipped'),
    ),
  }),
  handler: async (ctx, args) => {
    return await upsertDocumentByExternalIdHelper(ctx, args);
  },
});
