/**
 * Convex validators for document operations
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

export const sourceProviderValidator = v.union(
  v.literal('onedrive'),
  v.literal('upload'),
  v.literal('sharepoint'),
);

export const sourceModeValidator = v.union(
  v.literal('auto'),
  v.literal('manual'),
);

export const ragStatusValidator = v.union(
  v.literal('pending'),
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('not_indexed'),
  v.literal('stale'),
);

export const ragInfoStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
);

export const ragInfoValidator = v.object({
  status: ragInfoStatusValidator,
  indexedAt: v.optional(v.number()),
  error: v.optional(v.string()),
});

const documentTypeValidator = v.union(v.literal('file'), v.literal('folder'));

const paginationValidator = v.object({
  hasNextPage: v.boolean(),
  currentPage: v.number(),
  pageSize: v.number(),
});

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
  teamId: v.optional(v.union(v.string(), v.null())),
  teamTags: v.optional(v.array(v.string())),
  createdBy: v.optional(v.string()),
  createdByName: v.optional(v.string()),
});

export const documentListResponseValidator = v.object({
  success: v.boolean(),
  items: v.array(documentItemValidator),
  totalItems: v.number(),
  pagination: v.optional(paginationValidator),
  error: v.optional(v.string()),
});

export const generateDocumentResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.string(),
  url: v.string(),
  fileName: v.string(),
  contentType: v.string(),
  extension: v.string(),
  size: v.number(),
});

export const generatePptxResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.string(),
  url: v.string(),
  fileName: v.string(),
  contentType: v.string(),
  size: v.number(),
});

export const generateDocxResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.string(),
  url: v.string(),
  fileName: v.string(),
  contentType: v.string(),
  size: v.number(),
});

export const uploadFileResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.optional(v.string()),
  documentId: v.optional(v.string()),
  error: v.optional(v.string()),
});

export const documentRecordValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  title: v.optional(v.string()),
  content: v.optional(v.string()),
  fileId: v.optional(v.string()),
  mimeType: v.optional(v.string()),
  extension: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
  sourceProvider: v.optional(sourceProviderValidator),
  externalItemId: v.optional(v.string()),
  ragInfo: v.optional(ragInfoValidator),
});
