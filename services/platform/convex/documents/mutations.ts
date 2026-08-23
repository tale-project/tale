import { ConvexError, v, type Infer } from 'convex/values';

import {
  jsonValueValidator,
  jsonRecordValidator,
} from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { mutation, type MutationCtx } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { assertNotHeld } from '../governance/legal_hold_guard';
import { markEntryChainDeleted } from '../knowledge_entries/helpers';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { blobRefValidator, type BlobRef } from '../lib/storage/blob_ref';
import { hasTeamAccess } from '../lib/team_access';
import { stopSyncForDeletedDocument } from '../onedrive/deactivate_sync_configs';
import { checkProjectAccess } from '../projects/access';
import {
  PROJECT_AUDIT_ACTIONS,
  PROJECT_RESOURCE_TYPE,
} from '../projects/audit_actions';
import {
  assertDocumentVisibleToUser,
  assertRecordTrashable,
  checkProjectDocumentAccess,
  isProjectScopedDocument,
} from './access';
import { createDocument } from './create_document';
import { auditControlledRecordDeletion } from './records';
import { updateDocument as updateDocumentHelper } from './update_document';
import { validateDocumentUpload } from './validate_upload';
import { sourceProviderValidator } from './validators';

export const updateDocument = mutation({
  args: {
    documentId: v.id('documents'),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    metadata: v.optional(jsonValueValidator),
    fileId: v.optional(blobRefValidator),
    mimeType: v.optional(v.string()),
    extension: v.optional(v.string()),
    sourceProvider: v.optional(sourceProviderValidator),
    externalItemId: v.optional(v.string()),
    teamIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new ConvexError({
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Document not found',
      });
    }

    const member = await getOrganizationMember(
      ctx,
      document.organizationId,
      authUser,
    );
    await assertDocumentVisibleToUser(ctx, document, {
      userId: member.userId,
      organizationId: document.organizationId,
    });

    // Project files: org membership alone is not enough — require edit
    // access to the owning project (the same standard as attach/detach).
    // Team assignment on a project doc is rejected inside the helper
    // (projectId/teamId mutual exclusivity).
    if (isProjectScopedDocument(document)) {
      const access = await checkProjectDocumentAccess(ctx, document, {
        userId: member.userId,
        organizationId: document.organizationId,
      });
      if (!access?.canEdit) {
        throw new ConvexError({ code: 'PROJECT_FORBIDDEN' });
      }
    }

    await updateDocumentHelper(ctx, {
      ...args,
      teamIds: args.teamIds,
      userId: member.userId,
    });
  },
});

export const deleteDocument = mutation({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new ConvexError({
        code: 'DOCUMENT_NOT_FOUND',
        message: 'Document not found',
      });
    }

    const member = await getOrganizationMember(
      ctx,
      document.organizationId,
      authUser,
    );
    await assertDocumentVisibleToUser(ctx, document, {
      userId: member.userId,
      organizationId: document.organizationId,
    });

    // Project files: deletion requires edit access to the owning project
    // (mirrors the update gate above and the attach/detach standard).
    if (isProjectScopedDocument(document)) {
      const access = await checkProjectDocumentAccess(ctx, document, {
        userId: member.userId,
        organizationId: document.organizationId,
      });
      if (!access?.canEdit) {
        throw new ConvexError({ code: 'PROJECT_FORBIDDEN' });
      }
    }

    // Controlled-record gate: a record in review, approved, or carrying any
    // approved version in its history cannot be deleted. Uncontrolled
    // documents and never-approved drafts delete exactly as today — the
    // draft deletion is audited just below so a controlled record never
    // leaves without a trace.
    assertRecordTrashable(document);
    await auditControlledRecordDeletion(ctx, {
      document,
      authUser,
      userId: member.userId,
    });

    // Synchronous hold check so the user sees an immediate error instead
    // of a silent success while the async cleanup throws (round-2 v08 B4).
    // Pass `createdBy` so the helper also respects custodian holds on
    // the document author.
    await assertNotHeld(
      ctx,
      document.organizationId,
      'document',
      String(args.documentId),
      undefined,
      document.createdBy ?? undefined,
    );

    // A directly-selected single-file OneDrive sync maps 1:1 to this document,
    // so deleting it means "stop syncing it" — otherwise the next scheduled
    // run re-imports the file the user just removed. No-op for manual uploads
    // and folder-member docs.
    await stopSyncForDeletedDocument(ctx, document);

    // Knowledge entries are backed by hub documents — deleting the backing
    // document from the Documents tab must not orphan the entry, so mark
    // every linked entry chain deleted too.
    const linkedTopicKeys = new Set<string>();
    for await (const entry of ctx.db
      .query('knowledgeEntries')
      .withIndex('by_documentId', (q) => q.eq('documentId', args.documentId))) {
      if (entry.deletedAt !== undefined) continue;
      linkedTopicKeys.add(entry.topicKey);
    }
    for (const topicKey of linkedTopicKeys) {
      await markEntryChainDeleted(ctx, document.organizationId, topicKey);
    }

    await ctx.scheduler.runAfter(
      0,
      internal.documents.internal_actions.deleteDocumentFromRag,
      {
        documentId: args.documentId,
      },
    );

    return null;
  },
});

export interface CreateDocumentFromUploadCoreArgs {
  organizationId: string;
  /** The acting user — the session identity, or the REST key holder. Org
   * membership and (for project scope) project edit access are re-checked
   * here against THIS user. */
  userId: string;
  /** Actor email for the audit trail; absent for principals with no email. */
  userEmail?: string;
  fileId: BlobRef;
  fileName: string;
  contentType?: string;
  contentHash?: string;
  metadata?: Infer<typeof jsonRecordValidator>;
  teamId?: string;
  folderId?: Id<'folders'>;
  fileSize?: number;
  projectId?: Id<'projects'>;
  skipRagIndexing?: boolean;
  /**
   * Always persist the fileMetadata row, even without a caller `fileSize` —
   * from the authoritative size `validateDocumentUpload` resolved (0 for an
   * `s3:` ref, corrected by its `verifyS3BlobSize` job). The REST door sets
   * this: its bind body carries no client size, and without the row an
   * explicit `skipRagIndexing: false` would silently index NOTHING (no row →
   * no queue, no status). Session callers omit it, keeping their legacy
   * "no size, no skip → no row until an explicit retry" behavior.
   */
  ensureFileMetadata?: boolean;
}

/**
 * The one upload-to-document core: project/folder scope validation, the
 * upload policy + `file:upload` charge (`validateDocumentUpload`), the
 * fileMetadata save (with the sticky `skipRagIndexing` opt-out), the document
 * insert, the file link, and the project attach audit. Shared by the session
 * `createDocumentFromUpload` and the machine door
 * (`internal_mutations.createDocumentFromUploadForUser`) so the two can never
 * drift. Callers own authentication only.
 */
export async function createDocumentFromUploadCore(
  ctx: MutationCtx,
  args: CreateDocumentFromUploadCoreArgs,
): Promise<{ success: boolean; documentId: Id<'documents'> }> {
  const member = await getOrganizationMember(ctx, args.organizationId, {
    userId: args.userId,
    email: args.userEmail,
    name: undefined,
  });

  // Project-scoped upload: validate the target project before anything is
  // written so a rejected upload leaves no stranded rows behind. Mirrors
  // `assertWritable` in convex/projects/mutations.ts.
  const project = args.projectId ? await ctx.db.get(args.projectId) : null;
  if (args.projectId) {
    if (args.teamId) {
      throw new ConvexError({
        code: 'DOCUMENT_SCOPE_CONFLICT',
        message: 'A project document cannot also carry a team',
      });
    }
    if (!project) {
      throw new ConvexError({
        code: 'PROJECT_NOT_FOUND',
        message: 'Project not found',
      });
    }
    if (project.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'ORG_FORBIDDEN',
        message: 'Project belongs to a different organization',
      });
    }
    const teamIds = await getUserTeamIds(ctx, args.userId);
    const access = checkProjectAccess(project, teamIds, member.role);
    if (!access.canRead) {
      throw new ConvexError({
        code: 'PROJECT_FORBIDDEN',
        message: 'You do not have access to this project',
      });
    }
    if (!access.canEdit) {
      throw new ConvexError({
        code: 'RBAC_FORBIDDEN',
        message: 'You do not have permission to add files to this project',
      });
    }
    // Upload into a project folder: the folder must belong to THIS
    // project. Anything else — missing, foreign org, hub folder, another
    // project's folder — is an opaque not-found (the caller cannot probe
    // other scopes through the upload path). Project edit access was
    // already established above.
    if (args.folderId) {
      const folder = await ctx.db.get(args.folderId);
      if (
        !folder ||
        folder.organizationId !== args.organizationId ||
        folder.projectId !== args.projectId
      ) {
        throw new ConvexError({
          code: 'FOLDER_NOT_FOUND',
          message: 'Folder not found',
        });
      }
    }
  }

  const userId = args.userId;
  const validatedUpload = await validateDocumentUpload(ctx, {
    organizationId: args.organizationId,
    userId,
    fileId: args.fileId,
    fileName: args.fileName,
    contentType: args.contentType,
    fileSize: args.fileSize,
  });

  let effectiveTeamId = args.teamId;

  // Hub upload into a folder (project uploads validated their folder in
  // the project branch above — no team inheritance applies there).
  if (args.folderId && !args.projectId) {
    const folder = await ctx.db.get(args.folderId);
    // A project folder reads as not-found for hub uploads, mirroring the
    // WebDAV/REST posture (isProjectScopedFolder — folders/access.ts).
    if (
      !folder ||
      folder.organizationId !== args.organizationId ||
      folder.projectId != null
    ) {
      throw new ConvexError({
        code: 'FOLDER_NOT_FOUND',
        message: 'Folder not found',
      });
    }
    if (folder.teamId) {
      const userTeamIds = await getUserTeamIds(ctx, args.userId);
      if (!hasTeamAccess(folder, userTeamIds)) {
        throw new ConvexError({
          code: 'FOLDER_NOT_ACCESSIBLE',
          message: 'Folder not accessible',
        });
      }
      effectiveTeamId = folder.teamId;
    }
  }

  let fileMetadataId;
  // A skip-flagged upload persists its fileMetadata row even when the
  // caller sent no fileSize: the row is where the opt-out lives, and
  // without it a later explicit retry (`ensureFileMetadataForDocument`)
  // would recreate the row unflagged and index the file after all.
  // `validateDocumentUpload` already resolved the authoritative byte count
  // for `_storage` blobs; an `s3:` ref without a client size falls back to
  // 0 and is corrected by the `verifyS3BlobSize` job saveFileMetadata
  // schedules for s3-backed rows.
  const metadataSize =
    args.fileSize ??
    (args.skipRagIndexing === true || args.ensureFileMetadata === true
      ? (validatedUpload.size ?? 0)
      : undefined);
  if (metadataSize != null) {
    fileMetadataId = await ctx.runMutation(
      internal.file_metadata.internal_mutations.saveFileMetadata,
      {
        organizationId: args.organizationId,
        storageId: args.fileId,
        fileName: args.fileName,
        contentType: validatedUpload.contentType,
        size: metadataSize,
        uploadedBy: userId,
        ...(args.skipRagIndexing === true && { skipRagIndexing: true }),
      },
    );
  }

  const result = await createDocument(ctx, {
    organizationId: args.organizationId,
    title: args.fileName,
    fileId: args.fileId,
    mimeType: validatedUpload.contentType,
    contentHash: args.contentHash,
    sourceProvider: 'upload',
    teamId: effectiveTeamId,
    projectId: args.projectId,
    metadata: args.metadata,
    createdBy: args.userId,
    folderId: args.folderId,
  });

  if (fileMetadataId) {
    await ctx.runMutation(
      internal.file_metadata.internal_mutations.linkDocumentToFile,
      {
        storageId: args.fileId,
        documentId: result.documentId,
      },
    );
  }

  if (project) {
    // Same trail `attachDocumentToProject` writes, so a create-in-project
    // upload is auditable as a file-attach scope transition.
    await ctx.db.patch(project._id, { updatedAt: Date.now() });
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: userId,
      actorEmail: args.userEmail,
      actorType: 'user',
      action: PROJECT_AUDIT_ACTIONS.fileAttached,
      category: 'data',
      resourceType: PROJECT_RESOURCE_TYPE,
      resourceId: String(project._id),
      resourceName: project.name,
      metadata: {
        documentId: String(result.documentId),
        previousTeamId: null,
      },
      status: 'success',
    });
  }

  return {
    success: true,
    documentId: result.documentId,
  };
}

export const createDocumentFromUpload = mutation({
  args: {
    organizationId: v.string(),
    fileId: blobRefValidator,
    fileName: v.string(),
    contentType: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
    teamId: v.optional(v.string()),
    folderId: v.optional(v.id('folders')),
    fileSize: v.optional(v.number()),
    // Scope the document to a project at insert. The former two-step flow
    // (org-wide create, then attachDocumentToProject) left the file in the
    // org-wide hub whenever the attach half failed (issue #2546).
    projectId: v.optional(v.id('projects')),
    /**
     * Never RAG-index this upload. Persisted on the fileMetadata row (sticky
     * — see the fileMetadata schema), so the later `linkDocumentToFile` and
     * every other hub enqueue chokepoint leave the file out of the org's
     * knowledge corpus. REST project-file uploads set this: those files are
     * project working material, not org knowledge.
     */
    skipRagIndexing: v.optional(v.boolean()),
  },
  returns: v.object({
    success: v.boolean(),
    documentId: v.id('documents'),
  }),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Unauthenticated',
      });
    }

    return await createDocumentFromUploadCore(ctx, {
      ...args,
      userId: authUser.userId,
      userEmail: authUser.email,
    });
  },
});
