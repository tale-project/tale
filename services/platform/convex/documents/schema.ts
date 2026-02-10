import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export const documentsTable = defineTable({
  organizationId: v.string(),
  title: v.optional(v.string()),
  content: v.optional(v.string()),
  fileId: v.optional(v.id('_storage')),
  mimeType: v.optional(v.string()),
  extension: v.optional(v.string()),
  sourceProvider: v.optional(
    v.union(
      v.literal('onedrive'),
      v.literal('upload'),
      v.literal('sharepoint'),
    ),
  ),
  externalItemId: v.optional(v.string()),
  siteId: v.optional(v.string()),
  driveId: v.optional(v.string()),
  contentHash: v.optional(v.string()),
  historyFiles: v.optional(v.array(v.id('_storage'))),
  teamTags: v.optional(v.array(v.string())),
  teamId: v.optional(v.string()),
  sharedWithTeamIds: v.optional(v.array(v.string())),
  ragInfo: v.optional(
    v.object({
      status: v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('completed'),
        v.literal('failed'),
      ),
      jobId: v.optional(v.string()),
      indexedAt: v.optional(v.number()),
      error: v.optional(v.string()),
    }),
  ),
  createdBy: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_createdBy', ['organizationId', 'createdBy'])
  .index('by_organizationId_and_sourceProvider', [
    'organizationId',
    'sourceProvider',
  ])
  .index('by_organizationId_and_externalItemId', [
    'organizationId',
    'externalItemId',
  ])
  .index('by_organizationId_and_extension', ['organizationId', 'extension'])
  .index('by_organizationId_and_title', ['organizationId', 'title']);
