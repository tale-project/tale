/**
 * Documents Queries
 *
 * Internal queries for document operations.
 */

import { v } from 'convex/values';
import { internalQuery } from '../_generated/server';
import * as DocumentsHelpers from './helpers';

const sourceProviderValidator = v.union(v.literal('onedrive'), v.literal('upload'));

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
