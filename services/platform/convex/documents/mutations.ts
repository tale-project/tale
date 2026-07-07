import { ConvexError, v } from 'convex/values';

import {
  isAllowedDocumentUpload,
  resolveFileType,
} from '../../lib/shared/file-types';
import {
  jsonValueValidator,
  jsonRecordValidator,
} from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { assertNotHeld } from '../governance/legal_hold_guard';
import { checkUploadPolicy } from '../governance/upload_enforcement';
import { markEntryChainDeleted } from '../knowledge_entries/helpers';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { hasTeamAccess } from '../lib/team_access';
import { stopSyncForDeletedDocument } from '../onedrive/deactivate_sync_configs';
import { checkProjectAccess } from '../projects/access';
import {
  PROJECT_AUDIT_ACTIONS,
  PROJECT_RESOURCE_TYPE,
} from '../projects/audit_actions';
import { checkProjectDocumentAccess, isProjectScopedDocument } from './access';
import { createDocument } from './create_document';
import { extractExtension } from './extract_extension';
import { updateDocument as updateDocumentHelper } from './update_document';
import { sourceProviderValidator } from './validators';

export const updateDocument = mutation({
  args: {
    documentId: v.id('documents'),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    metadata: v.optional(jsonValueValidator),
    fileId: v.optional(v.id('_storage')),
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

    await getOrganizationMember(ctx, document.organizationId, authUser);

    // Project files: org membership alone is not enough — require edit
    // access to the owning project (the same standard as attach/detach).
    // Team assignment on a project doc is rejected inside the helper
    // (projectId/teamId mutual exclusivity).
    if (isProjectScopedDocument(document)) {
      const access = await checkProjectDocumentAccess(ctx, document, {
        userId: authUser.userId,
        organizationId: document.organizationId,
      });
      if (!access?.canEdit) {
        throw new ConvexError({ code: 'PROJECT_FORBIDDEN' });
      }
    }

    await updateDocumentHelper(ctx, {
      ...args,
      teamIds: args.teamIds,
      userId: authUser.userId,
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

    await getOrganizationMember(ctx, document.organizationId, authUser);

    // Project files: deletion requires edit access to the owning project
    // (mirrors the update gate above and the attach/detach standard).
    if (isProjectScopedDocument(document)) {
      const access = await checkProjectDocumentAccess(ctx, document, {
        userId: authUser.userId,
        organizationId: document.organizationId,
      });
      if (!access?.canEdit) {
        throw new ConvexError({ code: 'PROJECT_FORBIDDEN' });
      }
    }

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

export const createDocumentFromUpload = mutation({
  args: {
    organizationId: v.string(),
    fileId: v.id('_storage'),
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

    const member = await getOrganizationMember(
      ctx,
      args.organizationId,
      authUser,
    );

    // Project-scoped upload: validate the target project before anything is
    // written so a rejected upload leaves no stranded rows behind. Mirrors
    // `assertWritable` in convex/projects/mutations.ts.
    const project = args.projectId ? await ctx.db.get(args.projectId) : null;
    if (args.projectId) {
      if (args.teamId || args.folderId) {
        throw new ConvexError({
          code: 'DOCUMENT_SCOPE_CONFLICT',
          message: 'A project document cannot also carry a team or folder',
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
      const teamIds = await getUserTeamIds(ctx, authUser.userId);
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
    }

    const resolvedContentType = resolveFileType(
      args.fileName,
      args.contentType ?? '',
    );

    const userId = authUser.userId;
    const ext = extractExtension(args.fileName);
    const policyCheck = await checkUploadPolicy(
      ctx,
      args.organizationId,
      userId,
      ext,
      resolvedContentType,
      args.fileSize ?? undefined,
    );
    if (!policyCheck.allowed) {
      throw new ConvexError({
        code: 'UPLOAD_POLICY_REJECTED',
        message: policyCheck.reason ?? 'Upload rejected by organization policy',
      });
    }

    if (!isAllowedDocumentUpload(resolvedContentType, args.fileName)) {
      throw new ConvexError({
        code: 'UNSUPPORTED_FILE_TYPE',
        message:
          'Unsupported file type. Supported formats: PDF, DOCX, ODT, XLSX, CSV, TXT, PPTX, images (JPEG, PNG, GIF, WEBP).',
      });
    }

    let effectiveTeamId = args.teamId;

    if (args.folderId) {
      const folder = await ctx.db.get(args.folderId);
      if (!folder || folder.organizationId !== args.organizationId) {
        throw new ConvexError({
          code: 'FOLDER_NOT_FOUND',
          message: 'Folder not found',
        });
      }
      if (folder.teamId) {
        const userTeamIds = await getUserTeamIds(ctx, authUser.userId);
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
    if (args.fileSize != null) {
      fileMetadataId = await ctx.runMutation(
        internal.file_metadata.internal_mutations.saveFileMetadata,
        {
          organizationId: args.organizationId,
          storageId: args.fileId,
          fileName: args.fileName,
          contentType: args.contentType ?? 'application/octet-stream',
          size: args.fileSize,
          uploadedBy: userId,
        },
      );
    }

    const result = await createDocument(ctx, {
      organizationId: args.organizationId,
      title: args.fileName,
      fileId: args.fileId,
      mimeType: args.contentType,
      contentHash: args.contentHash,
      sourceProvider: 'upload',
      teamId: effectiveTeamId,
      projectId: args.projectId,
      metadata: args.metadata,
      createdBy: authUser.userId,
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
        actorEmail: authUser.email,
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
  },
});
