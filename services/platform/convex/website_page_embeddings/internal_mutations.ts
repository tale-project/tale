/**
 * Internal Mutations for Website Page Embeddings
 */

import { v } from 'convex/values';

import { internalMutation } from '../_generated/server';

const embeddingRecordFields = {
  organizationId: v.string(),
  websiteId: v.id('websites'),
  pageId: v.id('websitePages'),
  embedding: v.array(v.float64()),
  url: v.string(),
  title: v.optional(v.string()),
  contentHash: v.string(),
  chunkIndex: v.number(),
  chunkContent: v.string(),
};

export const deleteByPageId = internalMutation({
  args: {
    organizationId: v.string(),
    pageId: v.id('websitePages'),
    dimension: v.number(),
  },
  handler: async (ctx, args) => {
    const { organizationId, pageId, dimension } = args;

    const indexFilter = (q: { eq: Function }) =>
      q.eq('organizationId', organizationId).eq('pageId', pageId);

    let count = 0;
    switch (dimension) {
      case 256: {
        const q = ctx.db
          .query('websitePageEmbeddings256')
          .withIndex('by_organizationId_and_pageId', indexFilter);
        for await (const r of q) {
          await ctx.db.delete(r._id);
          count++;
        }
        break;
      }
      case 512: {
        const q = ctx.db
          .query('websitePageEmbeddings512')
          .withIndex('by_organizationId_and_pageId', indexFilter);
        for await (const r of q) {
          await ctx.db.delete(r._id);
          count++;
        }
        break;
      }
      case 1024: {
        const q = ctx.db
          .query('websitePageEmbeddings1024')
          .withIndex('by_organizationId_and_pageId', indexFilter);
        for await (const r of q) {
          await ctx.db.delete(r._id);
          count++;
        }
        break;
      }
      case 1536: {
        const q = ctx.db
          .query('websitePageEmbeddings1536')
          .withIndex('by_organizationId_and_pageId', indexFilter);
        for await (const r of q) {
          await ctx.db.delete(r._id);
          count++;
        }
        break;
      }
      case 2048: {
        const q = ctx.db
          .query('websitePageEmbeddings2048')
          .withIndex('by_organizationId_and_pageId', indexFilter);
        for await (const r of q) {
          await ctx.db.delete(r._id);
          count++;
        }
        break;
      }
      case 2560: {
        const q = ctx.db
          .query('websitePageEmbeddings2560')
          .withIndex('by_organizationId_and_pageId', indexFilter);
        for await (const r of q) {
          await ctx.db.delete(r._id);
          count++;
        }
        break;
      }
      case 4096: {
        const q = ctx.db
          .query('websitePageEmbeddings4096')
          .withIndex('by_organizationId_and_pageId', indexFilter);
        for await (const r of q) {
          await ctx.db.delete(r._id);
          count++;
        }
        break;
      }
      default:
        throw new Error(`Unsupported embedding dimension: ${dimension}`);
    }
    return count;
  },
});

export const insertEmbedding256 = internalMutation({
  args: embeddingRecordFields,
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('websitePageEmbeddings256', {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const insertEmbedding512 = internalMutation({
  args: embeddingRecordFields,
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('websitePageEmbeddings512', {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const insertEmbedding1024 = internalMutation({
  args: embeddingRecordFields,
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('websitePageEmbeddings1024', {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const insertEmbedding1536 = internalMutation({
  args: embeddingRecordFields,
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('websitePageEmbeddings1536', {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const insertEmbedding2048 = internalMutation({
  args: embeddingRecordFields,
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('websitePageEmbeddings2048', {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const insertEmbedding2560 = internalMutation({
  args: embeddingRecordFields,
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('websitePageEmbeddings2560', {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const insertEmbedding4096 = internalMutation({
  args: embeddingRecordFields,
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert('websitePageEmbeddings4096', {
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});
