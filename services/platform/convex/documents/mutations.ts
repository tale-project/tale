/**
 * Documents Mutations
 *
 * Internal and public mutations for document operations.
 * All mutations are thin wrappers that delegate to helper functions.
 */

import { v } from 'convex/values';
import { internalMutation, mutation } from '../_generated/server';
import { jsonValueValidator, jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { createDocument } from './create_document';
import { deleteDocument as deleteDocumentHelper } from './delete_document';
import { updateDocumentInternal as updateDocumentInternalHelper } from './update_document_internal';
import { updateDocumentRagInfo as updateDocumentRagInfoHelper } from './update_document_rag_info';
import { updateDocument as updateDocumentHelper } from './update_document';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { internal } from '../_generated/api';
import { sourceProviderValidator, ragInfoValidator } from './validators';

/**
 * Update a document (internal mutation without user validation)
 */
export const updateDocumentInternal = internalMutation({
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
    teamTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await updateDocumentInternalHelper(ctx, args);
  },
});

/**
 * Update document RAG info (internal mutation)
 */
export const updateDocumentRagInfo = internalMutation({
  args: {
    documentId: v.id('documents'),
    ragInfo: ragInfoValidator,
  },
  handler: async (ctx, args) => {
    await updateDocumentRagInfoHelper(ctx, args);
  },
});

/**
 * Create a document (internal mutation)
 */
export const createDocumentInternal = internalMutation({
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
    teamTags: v.optional(v.array(v.string())),
    createdBy: v.optional(v.string()),
  },
  returns: v.id('documents'),
  handler: async (ctx, args) => {
    const result = await createDocument(ctx, args);
    return result.documentId;
  },
});

// =============================================================================
// PUBLIC MUTATIONS (for frontend via api.documents.mutations.*)
// =============================================================================

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((val, i) => val === sortedB[i]);
}

/**
 * Update a document (public mutation with auth)
 */
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
    teamTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    await getOrganizationMember(ctx, document.organizationId, {
      userId: authUser.userId ?? '',
      email: authUser.email,
      name: authUser.name,
    });

    const oldTeamTags = document.teamTags;
    const wasIndexed = document.ragInfo?.status === 'completed';

    await updateDocumentHelper(ctx, {
      ...args,
      userId: String(authUser._id),
    });

    if (
      args.teamTags !== undefined &&
      wasIndexed &&
      !arraysEqual(oldTeamTags, args.teamTags)
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.documents.actions.reindexDocumentRag,
        { documentId: args.documentId },
      );
    }
  },
});

/**
 * Delete a document (public mutation with auth)
 */
export const deleteDocument = mutation({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    await getOrganizationMember(ctx, document.organizationId, {
      userId: authUser.userId ?? '',
      email: authUser.email,
      name: authUser.name,
    });

    await deleteDocumentHelper(ctx, args.documentId);

    await ctx.scheduler.runAfter(0, internal.documents.actions.deleteDocumentFromRag, {
      documentId: String(args.documentId),
    });

    return null;
  },
});

/**
 * Create a document from file upload (public mutation with auth)
 */
export const createDocumentFromUpload = mutation({
  args: {
    organizationId: v.string(),
    fileId: v.id('_storage'),
    fileName: v.string(),
    contentType: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    metadata: v.optional(jsonRecordValidator),
    teamTags: v.optional(v.array(v.string())),
  },
  returns: v.object({
    success: v.boolean(),
    documentId: v.id('documents'),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: authUser.userId ?? '',
      email: authUser.email,
      name: authUser.name,
    });

    const result = await createDocument(ctx, {
      organizationId: args.organizationId,
      title: args.fileName,
      fileId: args.fileId,
      mimeType: args.contentType,
      contentHash: args.contentHash,
      sourceProvider: 'upload',
      teamTags: args.teamTags,
      metadata: args.metadata,
      createdBy: String(authUser._id),
    });

    return {
      success: true,
      documentId: result.documentId,
    };
  },
});
