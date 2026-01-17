/**
 * Documents Mutations
 *
 * Internal mutations for document operations.
 */

import { v } from 'convex/values';
import { internalMutation } from '../_generated/server';
import { jsonValueValidator, jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import * as DocumentsHelpers from './helpers';

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
    metadata: v.optional(jsonValueValidator),
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
