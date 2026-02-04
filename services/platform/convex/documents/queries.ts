/**
 * Documents Queries
 *
 * Internal and public queries for document operations.
 */

import { v } from 'convex/values';
import { internalQuery, query } from '../_generated/server';
import * as DocumentsHelpers from './helpers';
import { authComponent } from '../auth';
import { getOrganizationMember } from '../lib/rls';
import { getUserTeamIds } from '../lib/get_user_teams';
import { documentItemValidator, sourceProviderValidator as srcProviderValidator } from './validators';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

const sourceProviderValidator = v.union(v.literal('onedrive'), v.literal('upload'), v.literal('sharepoint'));

/**
 * Get a document by ID (internal query)
 */
export const getDocumentById = internalQuery({
  args: {
    documentId: v.id('documents'),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.getDocumentById(ctx, args.documentId);
  },
});

/**
 * List documents by extension (internal query)
 */
export const listDocumentsByExtension = internalQuery({
  args: {
    organizationId: v.string(),
    extension: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.listDocumentsByExtension(ctx, args);
  },
});

/**
 * Query documents with pagination (internal query)
 */
export const queryDocuments = internalQuery({
  args: {
    organizationId: v.string(),
    sourceProvider: v.optional(sourceProviderValidator),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.queryDocuments(ctx, args);
  },
});

/**
 * Find document by external ID (internal query)
 */
export const findDocumentByExternalId = internalQuery({
  args: {
    organizationId: v.string(),
    externalItemId: v.string(),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.findDocumentByExternalId(ctx, args);
  },
});

// =============================================================================
// PUBLIC QUERIES (for frontend via api.documents.queries.*)
// =============================================================================

/**
 * Get a document by ID (public query).
 */
export const getDocumentByIdPublic = query({
  args: {
    documentId: v.id('documents'),
  },
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) {
      return { success: false, error: 'Unauthorized' };
    }

    return await DocumentsHelpers.getDocumentByIdPublic(ctx, args.documentId);
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
      return { success: false, error: 'Unauthorized' };
    }

    // Verify user has access to this organization
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser.userId ?? '',
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
export const getDocumentsCursor = query({
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

    // Verify user has access to this organization
    try {
      await getOrganizationMember(ctx, args.organizationId, {
        userId: authUser.userId ?? '',
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
