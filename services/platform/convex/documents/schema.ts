import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

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
      v.literal('agent'),
    ),
  ),
  externalItemId: v.optional(v.string()),
  siteId: v.optional(v.string()),
  driveId: v.optional(v.string()),
  contentHash: v.optional(v.string()),
  historyFiles: v.optional(v.array(v.id('_storage'))),
  teamId: v.optional(v.string()),
  /** @deprecated Use teamId instead. Kept for backward compatibility during migration. */
  teamTags: v.optional(v.array(v.string())),
  /** @deprecated Removed in single-team model. Kept for backward compatibility during migration. */
  sharedWithTeamIds: v.optional(v.array(v.string())),
  ragInfo: v.optional(
    v.object({
      status: v.union(
        v.literal('queued'),
        v.literal('running'),
        v.literal('completed'),
        v.literal('failed'),
      ),
      indexedAt: v.optional(v.number()),
      /** @deprecated No longer written; use document.fileId directly. Kept for backward compatibility. */
      indexedFileId: v.optional(v.id('_storage')),
      error: v.optional(v.string()),
      /** @deprecated No longer written, kept for backward compatibility with existing data. */
      jobId: v.optional(v.string()),
    }),
  ),
  indexed: v.optional(v.boolean()),
  sourceCreatedAt: v.optional(v.number()),
  sourceModifiedAt: v.optional(v.number()),
  createdBy: v.optional(v.string()),
  folderId: v.optional(v.id('folders')),
  metadata: v.optional(jsonRecordValidator),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_folderId', ['organizationId', 'folderId'])
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
  .index('by_organizationId_and_title', ['organizationId', 'title'])
  .index('by_organizationId_and_fileId', ['organizationId', 'fileId'])
  .index('by_organizationId_and_indexed', ['organizationId', 'indexed']);
