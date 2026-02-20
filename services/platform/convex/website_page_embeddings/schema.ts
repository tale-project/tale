/**
 * Website Page Embeddings Schema
 *
 * Pre-defined multi-dimension vector tables for semantic search.
 * Users select which dimension to use via the EMBEDDING_DIMENSIONS env var.
 * Convex vectorIndex supports dimensions between 2 and 4096.
 */

import { defineTable } from 'convex/server';
import { v } from 'convex/values';

function defineEmbeddingTable(dimensions: number) {
  return defineTable({
    organizationId: v.string(),
    websiteId: v.id('websites'),
    pageId: v.id('websitePages'),
    embedding: v.array(v.float64()),
    url: v.string(),
    title: v.optional(v.string()),
    contentHash: v.string(),
    chunkIndex: v.number(),
    chunkContent: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_organizationId', ['organizationId'])
    .index('by_pageId', ['pageId'])
    .index('by_organizationId_and_pageId', ['organizationId', 'pageId'])
    .searchIndex('by_content', {
      searchField: 'chunkContent',
      filterFields: ['organizationId', 'websiteId'],
    })
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions,
      filterFields: ['organizationId', 'websiteId'],
    });
}

export const websitePageEmbeddings256Table = defineEmbeddingTable(256);
export const websitePageEmbeddings512Table = defineEmbeddingTable(512);
export const websitePageEmbeddings1024Table = defineEmbeddingTable(1024);
export const websitePageEmbeddings1536Table = defineEmbeddingTable(1536);
export const websitePageEmbeddings2048Table = defineEmbeddingTable(2048);
export const websitePageEmbeddings2560Table = defineEmbeddingTable(2560);
export const websitePageEmbeddings4096Table = defineEmbeddingTable(4096);
