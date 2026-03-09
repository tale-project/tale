import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const fileMetadataTable = defineTable({
  organizationId: v.string(),
  storageId: v.id('_storage'),
  fileName: v.string(),
  contentType: v.string(),
  size: v.number(),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_storageId', ['storageId']);
