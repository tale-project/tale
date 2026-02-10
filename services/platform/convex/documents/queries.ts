/**
 * Documents Queries
 */

import { v } from 'convex/values';

import { query } from '../_generated/server';
import { getUserTeamIds } from '../lib/get_user_teams';
import { getAuthUserIdentity, getOrganizationMember } from '../lib/rls';
import * as DocumentsHelpers from './helpers';

export const getDocumentById = query({
  args: {
    documentId: v.id('documents'),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return { success: false, error: 'Unauthenticated' };
    }

    const document = await ctx.db.get(args.documentId);
    if (!document) {
      return { success: false, error: 'Document not found' };
    }

    try {
      await getOrganizationMember(ctx, document.organizationId, authUser);
    } catch {
      return { success: false, error: 'Access denied' };
    }

    return await DocumentsHelpers.getDocumentByIdTransformed(
      ctx,
      args.documentId,
    );
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
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return { success: false, error: 'Unauthenticated' };
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
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
    filterTeamId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      return { page: [], isDone: true, continueCursor: '' };
    }

    try {
      await getOrganizationMember(ctx, args.organizationId, authUser);
    } catch {
      return { page: [], isDone: true, continueCursor: '' };
    }

    const userTeamIds = await getUserTeamIds(ctx, authUser.userId);

    return await DocumentsHelpers.getDocumentsCursor(ctx, {
      ...args,
      userTeamIds,
    });
  },
});
