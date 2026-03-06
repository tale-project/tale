import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import * as DocumentsHelpers from './helpers';
import { sourceProviderValidator } from './validators';

export const getDocumentByIdRaw = internalQuery({
  args: {
    documentId: v.id('documents'),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.getDocumentById(ctx, args.documentId);
  },
});

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

export const getDocumentsForRagSync = internalQuery({
  args: {
    documentIds: v.array(v.id('documents')),
  },
  handler: async (ctx, args) => {
    const docs = [];

    for (const id of args.documentIds) {
      const doc = await ctx.db.get(id);
      if (!doc?.ragInfo) continue;
      const { status } = doc.ragInfo;
      if (
        status === 'queued' ||
        status === 'running' ||
        status === 'completed'
      ) {
        docs.push({
          _id: doc._id,
          _creationTime: doc._creationTime,
          ragInfo: doc.ragInfo,
        });
      }
    }

    return docs;
  },
});

export const findDocumentByExternalId = internalQuery({
  args: {
    organizationId: v.string(),
    externalItemId: v.string(),
  },
  handler: async (ctx, args) => {
    return await DocumentsHelpers.findDocumentByExternalId(ctx, args);
  },
});
