/**
 * Convex validators for document model
 */

import { v } from 'convex/values';

/**
 * RAG status validator
 */
export const ragStatusValidator = v.union(
  v.literal('pending'),
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('not_indexed'),
  v.literal('stale'),
);

/**
 * Source provider validator
 */
export const sourceProviderValidator = v.union(
  v.literal('onedrive'),
  v.literal('upload'),
);

/**
 * Source mode validator
 */
export const sourceModeValidator = v.union(
  v.literal('auto'),
  v.literal('manual'),
);

/**
 * Document type validator
 */
export const documentTypeValidator = v.union(
  v.literal('file'),
  v.literal('folder'),
);

/**
 * Document item validator (for public API responses)
 */
export const documentItemValidator = v.object({
  id: v.string(),
  name: v.optional(v.string()),
  type: documentTypeValidator,
  size: v.optional(v.number()),
  mimeType: v.optional(v.string()),
  extension: v.optional(v.string()),
  storagePath: v.optional(v.string()),
  sourceProvider: v.optional(sourceProviderValidator),
  sourceMode: v.optional(sourceModeValidator),
  lastModified: v.optional(v.number()),
  syncConfigId: v.optional(v.string()),
  isDirectlySelected: v.optional(v.boolean()),
  url: v.optional(v.string()),
  ragStatus: v.optional(ragStatusValidator),
  ragIndexedAt: v.optional(v.number()),
  ragError: v.optional(v.string()),
});

/**
 * Pagination validator
 */
export const paginationValidator = v.object({
  hasNextPage: v.boolean(),
  currentPage: v.number(),
  pageSize: v.number(),
});

/**
 * Document list response validator
 */
export const documentListResponseValidator = v.object({
  success: v.boolean(),
  items: v.array(documentItemValidator),
  totalItems: v.number(),
  pagination: v.optional(paginationValidator),
  error: v.optional(v.string()),
});

/**
 * Document record validator (raw database document)
 */
export const documentRecordValidator = v.object({
  _id: v.id('documents'),
  _creationTime: v.number(),
  organizationId: v.string(),
  title: v.optional(v.string()),

  content: v.optional(v.string()),
  fileId: v.optional(v.id('_storage')),
  mimeType: v.optional(v.string()),
  extension: v.optional(v.string()),
  metadata: v.optional(v.any()),
  sourceProvider: v.optional(sourceProviderValidator),
  externalItemId: v.optional(v.string()),
});

