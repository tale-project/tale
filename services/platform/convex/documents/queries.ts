/**
 * Documents Queries
 */

import { v } from 'convex/values';
import { query } from '../_generated/server';
import * as DocumentsHelpers from './helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { getUserTeamIds } from '../lib/get_user_teams';

export const getDocumentById = query({
  args: {
    documentId: v.id('documents'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return { success: false, error: 'Unauthenticated' };
    }

    const document = await ctx.db.get(args.documentId);
    if (!document) {
      return { success: false, error: 'Document not found' };
    }

    try {
      await getOrganizationMember(ctx, document.organizationId, {
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return { success: false, error: 'Access denied' };
    }

    return await DocumentsHelpers.getDocumentByIdTransformed(ctx, args.documentId);
  },
});

/**
 * Get a document by storage path (public query).
 */
export const getDocumentByPath = query({
  args: {
    organizationId: v.string(),
    storagePath: v.string(),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return { success: false, error: 'Unauthenticated' };
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return { success: false, error: 'Access denied' };
    }

    return await DocumentsHelpers.getDocumentByPath(ctx, args);
  },
});

/**
 * Get documents with cursor-based pagination (public query).
 */
export const listDocuments = query({
  args: {
    organizationId: v.string(),
    numItems: v.optional(v.number()),
    cursor: v.union(v.string(), v.null()),
    query: v.optional(v.string()),
    folderPath: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: String(authUser._id),
        email: authUser.email,
        name: authUser.name,
      });
    } catch {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const userTeamIds = await getUserTeamIds(ctx, String(authUser._id));

    return await DocumentsHelpers.getDocumentsCursor(ctx, {
      ...args,
      userTeamIds,
    });
  },
});
