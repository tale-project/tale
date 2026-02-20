/**
 * Internal Queries for Website Page Embeddings
 */

import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';

export const getPageById = internalQuery({
  args: { pageId: v.id('websitePages') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.pageId);
  },
});

export const getExistingEmbeddingHash = internalQuery({
  args: {
    organizationId: v.string(),
    pageId: v.id('websitePages'),
    dimension: v.number(),
  },
  handler: async (ctx, args) => {
    const { organizationId, pageId, dimension } = args;

    const indexFilter = (q: { eq: Function }) =>
      q.eq('organizationId', organizationId).eq('pageId', pageId);

    let record;
    switch (dimension) {
      case 256:
        record = await ctx.db
          .query('websitePageEmbeddings256')
          .withIndex('by_organizationId_and_pageId', indexFilter)
          .first();
        break;
      case 512:
        record = await ctx.db
          .query('websitePageEmbeddings512')
          .withIndex('by_organizationId_and_pageId', indexFilter)
          .first();
        break;
      case 1024:
        record = await ctx.db
          .query('websitePageEmbeddings1024')
          .withIndex('by_organizationId_and_pageId', indexFilter)
          .first();
        break;
      case 1536:
        record = await ctx.db
          .query('websitePageEmbeddings1536')
          .withIndex('by_organizationId_and_pageId', indexFilter)
          .first();
        break;
      case 2048:
        record = await ctx.db
          .query('websitePageEmbeddings2048')
          .withIndex('by_organizationId_and_pageId', indexFilter)
          .first();
        break;
      case 2560:
        record = await ctx.db
          .query('websitePageEmbeddings2560')
          .withIndex('by_organizationId_and_pageId', indexFilter)
          .first();
        break;
      case 4096:
        record = await ctx.db
          .query('websitePageEmbeddings4096')
          .withIndex('by_organizationId_and_pageId', indexFilter)
          .first();
        break;
      default:
        return null;
    }

    return record ? { contentHash: record.contentHash } : null;
  },
});

export const fullTextSearch = internalQuery({
  args: {
    organizationId: v.string(),
    websiteId: v.optional(v.id('websites')),
    query: v.string(),
    limit: v.number(),
    dimension: v.number(),
  },
  handler: async (ctx, args) => {
    const { organizationId, websiteId, query, limit, dimension } = args;

    const searchFilter = websiteId
      ? (q: { search: Function }) =>
          q
            .search('chunkContent', query)
            .eq('organizationId', organizationId)
            .eq('websiteId', websiteId)
      : (q: { search: Function }) =>
          q.search('chunkContent', query).eq('organizationId', organizationId);

    switch (dimension) {
      case 256:
        return await ctx.db
          .query('websitePageEmbeddings256')
          .withSearchIndex('by_content', searchFilter)
          .take(limit);
      case 512:
        return await ctx.db
          .query('websitePageEmbeddings512')
          .withSearchIndex('by_content', searchFilter)
          .take(limit);
      case 1024:
        return await ctx.db
          .query('websitePageEmbeddings1024')
          .withSearchIndex('by_content', searchFilter)
          .take(limit);
      case 1536:
        return await ctx.db
          .query('websitePageEmbeddings1536')
          .withSearchIndex('by_content', searchFilter)
          .take(limit);
      case 2048:
        return await ctx.db
          .query('websitePageEmbeddings2048')
          .withSearchIndex('by_content', searchFilter)
          .take(limit);
      case 2560:
        return await ctx.db
          .query('websitePageEmbeddings2560')
          .withSearchIndex('by_content', searchFilter)
          .take(limit);
      case 4096:
        return await ctx.db
          .query('websitePageEmbeddings4096')
          .withSearchIndex('by_content', searchFilter)
          .take(limit);
      default:
        return [];
    }
  },
});

export const fetchSearchResults256 = internalQuery({
  args: { ids: v.array(v.id('websitePageEmbeddings256')) },
  handler: async (ctx, args) => {
    return await Promise.all(args.ids.map((id) => ctx.db.get(id)));
  },
});

export const fetchSearchResults512 = internalQuery({
  args: { ids: v.array(v.id('websitePageEmbeddings512')) },
  handler: async (ctx, args) => {
    return await Promise.all(args.ids.map((id) => ctx.db.get(id)));
  },
});

export const fetchSearchResults1024 = internalQuery({
  args: { ids: v.array(v.id('websitePageEmbeddings1024')) },
  handler: async (ctx, args) => {
    return await Promise.all(args.ids.map((id) => ctx.db.get(id)));
  },
});

export const fetchSearchResults1536 = internalQuery({
  args: { ids: v.array(v.id('websitePageEmbeddings1536')) },
  handler: async (ctx, args) => {
    return await Promise.all(args.ids.map((id) => ctx.db.get(id)));
  },
});

export const fetchSearchResults2048 = internalQuery({
  args: { ids: v.array(v.id('websitePageEmbeddings2048')) },
  handler: async (ctx, args) => {
    return await Promise.all(args.ids.map((id) => ctx.db.get(id)));
  },
});

export const fetchSearchResults2560 = internalQuery({
  args: { ids: v.array(v.id('websitePageEmbeddings2560')) },
  handler: async (ctx, args) => {
    return await Promise.all(args.ids.map((id) => ctx.db.get(id)));
  },
});

export const fetchSearchResults4096 = internalQuery({
  args: { ids: v.array(v.id('websitePageEmbeddings4096')) },
  handler: async (ctx, args) => {
    return await Promise.all(args.ids.map((id) => ctx.db.get(id)));
  },
});
