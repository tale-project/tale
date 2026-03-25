import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';
import { internalMutation } from '../_generated/server';
import { createDocument as createDocumentHelper } from './create_document';
import { updateDocumentInternal as updateDocumentInternalHelper } from './update_document_internal';
import { updateDocumentRagInfo as updateDocumentRagInfoHelper } from './update_document_rag_info';
import { sourceProviderValidator, ragInfoValidator } from './validators';

export const updateDocument = internalMutation({
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
    teamId: v.optional(v.string()),
    folderId: v.optional(v.id('folders')),
  },
  handler: async (ctx, args) => {
    await updateDocumentInternalHelper(ctx, args);
  },
});

export const updateDocumentRagInfo = internalMutation({
  args: {
    documentId: v.id('documents'),
    ragInfo: ragInfoValidator,
  },
  handler: async (ctx, args) => {
    await updateDocumentRagInfoHelper(ctx, args);
  },
});

export const deleteDocumentById = internalMutation({
  args: {
    documentId: v.id('documents'),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (document) {
      const { fileId } = document;
      if (fileId) {
        const metadata = await ctx.db
          .query('fileMetadata')
          .withIndex('by_storageId', (q) => q.eq('storageId', fileId))
          .first();
        if (metadata?.documentId === args.documentId) {
          await ctx.db.patch(metadata._id, { documentId: undefined });
        }
      }
      await ctx.db.delete(args.documentId);
    }
    return null;
  },
});

export const updateDocumentDates = internalMutation({
  args: {
    documentId: v.id('documents'),
    sourceCreatedAt: v.optional(v.number()),
    sourceModifiedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const document = await ctx.db.get(args.documentId);
    if (!document) {
      return null;
    }

    const patch: Record<string, number> = {};
    if (args.sourceCreatedAt != null) {
      patch.sourceCreatedAt = args.sourceCreatedAt;
    }
    if (args.sourceModifiedAt != null) {
      patch.sourceModifiedAt = args.sourceModifiedAt;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.documentId, patch);
    }

    return null;
  },
});

export const backfillIndexedField = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    processed: v.number(),
    updated: v.number(),
    cursor: v.union(v.string(), v.null()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 500;
    let updated = 0;

    const result = await ctx.db
      .query('documents')
      .order('asc')
      .paginate({ cursor: args.cursor ?? null, numItems: batchSize });

    for (const doc of result.page) {
      const shouldBeIndexed = doc.ragInfo?.status === 'completed';
      if (doc.indexed !== shouldBeIndexed) {
        await ctx.db.patch(doc._id, { indexed: shouldBeIndexed });
        updated++;
      }
    }

    return {
      processed: result.page.length,
      updated,
      cursor: result.continueCursor,
      done: result.isDone,
    };
  },
});

export const createDocument = internalMutation({
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
    teamId: v.optional(v.string()),
    createdBy: v.optional(v.string()),
    folderId: v.optional(v.id('folders')),
  },
  returns: v.id('documents'),
  handler: async (ctx, args) => {
    const result = await createDocumentHelper(ctx, args);
    return result.documentId;
  },
});
