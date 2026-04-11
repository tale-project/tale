import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const fileMetadataTable = defineTable({
  organizationId: v.string(),
  storageId: v.id('_storage'),
  documentId: v.optional(v.id('documents')),
  source: v.optional(v.union(v.literal('user'), v.literal('agent'))),
  fileName: v.string(),
  contentType: v.string(),
  size: v.number(),
  ragStatus: v.optional(
    v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
    ),
  ),
  ragError: v.optional(v.string()),
  ragProgress: v.optional(v.string()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_storageId', ['storageId'])
  .index('by_organizationId_and_documentId', ['organizationId', 'documentId'])
  .index('by_organizationId_and_source_and_documentId', [
    'organizationId',
    'source',
    'documentId',
  ]);
