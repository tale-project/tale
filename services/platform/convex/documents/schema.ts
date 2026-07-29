import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';
import { blobRefValidator } from '../lib/storage/blob_ref';
import { jsonRecordValidator } from '../lib/validators/json';

export const documentsTable = defineTable({
  organizationId: v.string(),
  title: v.optional(v.string()),
  content: v.optional(v.string()),
  // Blob reference for the source file: a Convex `_storage` id (deployment
  // default) OR an `s3:<key>` ref when the org routes blobs at its own bucket.
  // Widened from `v.id('_storage')` — every existing id still validates.
  fileId: v.optional(blobRefValidator),
  mimeType: v.optional(v.string()),
  extension: v.optional(v.string()),
  // Open string. Equal to the connector slug for connector-sourced docs
  // (`onedrive`, `sharepoint`, `google_drive`, …); reserved values `upload` and
  // `agent` cover non-connector sources. New connectors require no schema
  // change.
  sourceProvider: v.optional(v.string()),
  externalItemId: v.optional(v.string()),
  siteId: v.optional(v.string()),
  driveId: v.optional(v.string()),
  contentHash: v.optional(v.string()),
  historyFiles: v.optional(v.array(blobRefValidator)),
  teamId: v.optional(v.string()),
  // Full list of team IDs the document belongs to (multi-team). `teamId`
  // mirrors the first entry for single-team consumers.
  teamTags: v.optional(v.array(v.string())),
  /**
   * Project this document belongs to. Mutually exclusive with `teamId`:
   * a doc is either a project doc, a team library doc, or an org library
   * doc (both null). Enforced in `attachDocumentToProject` /
   * `detachDocumentFromProject` (services/platform/convex/projects/mutations.ts).
   * RAG retrieval unions project docs via `getAgentScopedFileIds`.
   */
  projectId: v.optional(v.id('projects')),
  scannedPagesDetected: v.optional(v.number()),
  ocrApplied: v.optional(v.boolean()),
  sourceCreatedAt: v.optional(v.number()),
  sourceModifiedAt: v.optional(v.number()),
  createdBy: v.optional(v.string()),
  folderId: v.optional(v.id('folders')),
  folderPath: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
  lifecycleStatus: v.optional(lifecycleStatusValidator),
  statusChangedAt: v.optional(v.number()),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_organizationId_and_lifecycleStatus', [
    'organizationId',
    'lifecycleStatus',
  ])
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
  // Bounded exact-match lookup for the WebDAV .trash resolver: find a
  // trashed doc by title without collecting every trashed row in the org.
  .index('by_org_lifecycle_title', [
    'organizationId',
    'lifecycleStatus',
    'title',
  ])
  // Bounded name-collision / leaf-resolve lookup for WebDAV: docs with an
  // exact title in an exact folder (0-1 active in practice). Without the
  // folderId column, a name repeated across a synced tree (package.json,
  // .DS_Store, index.html) makes the (org,title) collect O(all-same-name).
  .index('by_org_title_folder', ['organizationId', 'title', 'folderId'])
  .index('by_organizationId_and_fileId', ['organizationId', 'fileId'])
  .index('by_organizationId_and_folderPath', ['organizationId', 'folderPath'])
  // Projects feature: list documents attached to a project.
  .index('by_organizationId_and_projectId', ['organizationId', 'projectId']);
