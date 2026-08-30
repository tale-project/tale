import { v } from 'convex/values';

import { AppError } from '../../lib/shared/errors/app-error';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import type { Id } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { cleanupEmptyAncestorFolders } from '../folders/cleanup_empty_ancestors';
import { eraseDocumentBlobs } from '../governance/erase_document_blobs';
import { assertNotHeld } from '../governance/legal_hold_guard';
import { blobRefValidator } from '../lib/storage/blob_ref';
import { consumeRestUploadIntentCore } from '../projects/rest_upload_intents';
import { assertRecordTrashable } from './access';
import { createDocument as createDocumentHelper } from './create_document';
import { createDocumentFromUploadCore } from './mutations';
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
        throw new AppError({
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

/**
 * Create a PROJECT document from an uploaded blob on behalf of an explicit
 * user — the backing mutation of `POST /api/v1/projects/{id}/files`. Reuses
 * the session `createDocumentFromUpload` core wholesale: membership + project
 * edit access re-run against `userId`, the folder-belongs-to-project opaque
 * 404, the per-org `file:upload` charge and upload policy validation
 * (authoritative size, MIME allowlist, scheduled s3 size verify), the sticky
 * `skipRagIndexing` persistence, and the project attach audit.
 *
 * Unlike the session mutation, `projectId` and `folderId` are REQUIRED —
 * this door only writes project working files into project folders — and
 * they arrive as wire strings (garbage collapses into the same opaque
 * refusals as absence).
 *
 * When `uploadId` is present, the REST upload intent is verified and consumed
 * IN THIS TRANSACTION, before the create core runs: any refusal after it — a
 * foreign folder, the upload policy, the per-org `file:upload` budget — rolls
 * the consume back, so the single-use handshake survives for a corrected
 * retry instead of orphaning the uploaded object (S3-lane objects are only
 * sweepable through their intent row).
 */
export const createDocumentFromUploadForUser = internalMutation({
  args: {
    organizationId: v.string(),
    userId: v.string(),
    userEmail: v.optional(v.string()),
    projectId: v.string(),
    folderId: v.string(),
    fileId: blobRefValidator,
    fileName: v.string(),
    contentType: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
    fileSize: v.optional(v.number()),
    skipRagIndexing: v.optional(v.boolean()),
    /** REST upload-intent id (`rest_upload_intents`), consumed atomically
     * with the create when present. */
    uploadId: v.optional(v.string()),
  },
  returns: v.object({ documentId: v.id('documents') }),
  handler: async (ctx, args): Promise<{ documentId: Id<'documents'> }> => {
    if (args.uploadId !== undefined) {
      await consumeRestUploadIntentCore(ctx, {
        organizationId: args.organizationId,
        userId: args.userId,
        projectId: args.projectId,
        uploadId: args.uploadId,
        fileId: args.fileId,
      });
    }
    const projectId = ctx.db.normalizeId('projects', args.projectId);
    if (projectId === null) {
      throw new AppError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }
    const folderId = ctx.db.normalizeId('folders', args.folderId);
    if (folderId === null) {
      throw new AppError({
        code: 'FOLDER_NOT_FOUND',
        message: 'Folder not found',
      });
    }

    const result = await createDocumentFromUploadCore(ctx, {
      organizationId: args.organizationId,
      userId: args.userId,
      userEmail: args.userEmail,
      fileId: args.fileId,
      fileName: args.fileName,
      contentType: args.contentType,
      contentHash: args.contentHash,
      metadata: args.metadata,
      fileSize: args.fileSize,
      projectId,
      folderId,
      skipRagIndexing: args.skipRagIndexing,
      // The REST bind body carries no client fileSize; persist the row from
      // the validated authoritative size so both the skip flag AND an
      // explicit opt-in to indexing have a home (see the core's arg doc).
      ensureFileMetadata: true,
    });
    return { documentId: result.documentId };
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
    /** Direct project scope for a folderless write (agent `document_create`
     * in a project-bound run) — a `folderId` still wins where given. */
    projectId: v.optional(v.id('projects')),
    /** When set, write a governance audit row attributed to this actor — the
     * standing-grant document writes (an agent's `document_create`) leave a
     * trail the way the task tools do. Sync/connector callers omit it. */
    auditActorId: v.optional(v.string()),
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
    const { auditActorId, ...upsertArgs } = args;
    const result = await upsertDocumentByExternalIdHelper(ctx, upsertArgs);
    // A skip changed nothing, so it leaves no audit row.
    if (auditActorId !== undefined && result.action !== 'skipped') {
      await createAuditLog(ctx, {
        organizationId: args.organizationId,
        actorId: auditActorId,
        actorType: 'api',
        action: result.action,
        category: 'data',
        resourceType: 'document',
        resourceId: String(result.documentId),
        resourceName: args.title,
        metadata: { viaAgent: true },
        status: 'success',
      });
    }
    return result;
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
