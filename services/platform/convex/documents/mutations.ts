import { v } from 'convex/values';

import {
  jsonValueValidator,
  jsonRecordValidator,
} from '../../lib/shared/schemas/utils/json-value';
import { internal } from '../_generated/api';
import { mutation } from '../_generated/server';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { createDocument } from './create_document';
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
    teamId: v.optional(v.union(v.string(), v.null())),
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
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

    await updateDocumentHelper(ctx, {
      ...args,
      teamId: args.teamId,
      userId: String(authUser._id),
    });
  },
});

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
      userId: String(authUser._id),
      email: authUser.email,
      name: authUser.name,
    });

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
  },
  returns: v.object({
    success: v.boolean(),
    documentId: v.id('documents'),
  }),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      throw new Error('Unauthenticated');
    }

    await getOrganizationMember(ctx, args.organizationId, {
      userId: String(authUser._id),
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
      teamId: args.teamId,
      metadata: args.metadata,
      createdBy: String(authUser._id),
      folderId: args.folderId,
    });

    return {
      success: true,
      documentId: result.documentId,
    };
  },
});
