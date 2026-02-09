import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const onedriveSyncConfigsTable = defineTable({
  organizationId: v.string(),
  userId: v.string(),
  itemType: v.union(v.literal('file'), v.literal('folder')),
  itemId: v.string(),
  itemName: v.string(),
  itemPath: v.optional(v.string()),
  targetBucket: v.string(),
  storagePrefix: v.optional(v.string()),
  teamTags: v.optional(v.array(v.string())),
  status: v.union(
    v.literal('active'),
    v.literal('inactive'),
    v.literal('error'),
  ),
  lastSyncAt: v.optional(v.number()),
  lastSyncStatus: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_status', ['organizationId', 'status'])
  .index('by_organizationId_and_itemId', ['organizationId', 'itemId'])
  .index('by_itemId', ['itemId'])
  .index('by_userId', ['userId']);
