/**
 * Documents Mutations
 *
 * Internal and public mutations for document operations.
 */

import { v } from 'convex/values';
import { internalMutation, mutation } from '../_generated/server';
import { jsonValueValidator, jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import * as DocumentsHelpers from './helpers';
import { createDocument } from './create_document';
import { deleteDocument as deleteDocumentHelper } from './delete_document';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';

const sourceProviderValidator = v.union(v.literal('onedrive'), v.literal('upload'));

const ragStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
);

const ragInfoValidator = v.object({
  status: ragStatusValidator,
  jobId: v.optional(v.string()),
  indexedAt: v.optional(v.number()),
  error: v.optional(v.string()),
});

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
    teamTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { documentId, ...updateData } = args;
    const document = await ctx.db.get(documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    // Remove undefined values
    const cleanUpdateData = Object.fromEntries(
      Object.entries(updateData).filter(([_, value]) => value !== undefined),
    );

    if (Object.keys(cleanUpdateData).length > 0) {
      await ctx.db.patch(documentId, cleanUpdateData);
    }
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
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    await ctx.db.patch(args.documentId, {
      ragInfo: args.ragInfo,
    });
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
      userId: authUser._id,
      email: authUser.email,
      name: authUser.name,
    });

    await deleteDocumentHelper(ctx, args.documentId);
    return null;
  },
});

export const createDocumentFromUpload = mutation({
  args: {
    organizationId: v.string(),
    fileId: v.id('_storage'),
    fileName: v.string(),
    contentType: v.optional(v.string()),
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
      userId: authUser._id,
      email: authUser.email,
      name: authUser.name,
    });

    const result = await createDocument(ctx, {
      organizationId: args.organizationId,
      title: args.fileName,
      fileId: args.fileId,
      mimeType: args.contentType,
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
