import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { lifecycleStatusValidator } from '../governance/soft_delete_validators';
import { blobRefValidator } from '../lib/storage/blob_ref';
import { jsonRecordValidator } from '../lib/validators/json';

/**
 * Controlled-record lifecycle state (phase 5). Opt-in per document
 * (`documents/records.ts::markControlled`); a document without `record`
 * behaves exactly as before.
 *
 * - `draft`: content is editable (the only editable state once controlled).
 * - `in_review`: frozen — a named human reviews a FIXED artifact via a
 *   `document_record_review` approval row.
 * - `approved`: immutable until `openRecordRevision` bumps the version and
 *   returns the record to `draft`.
 *
 * `approvedVersions` is the supersede chain: one immutably-addressable
 * snapshot per approved version (the snapshot blob is also appended to
 * `historyFiles` at approve time so the version list and the delete-time
 * blob erase keep covering it).
 */
export const controlledRecordStateValidator = v.union(
  v.literal('draft'),
  v.literal('in_review'),
  v.literal('approved'),
);

export const controlledRecordValidator = v.object({
  state: controlledRecordStateValidator,
  /** Monotonic, starts at 1; bumped only by `openRecordRevision`. */
  version: v.number(),
  controlledAt: v.number(),
  controlledBy: v.string(),
  submittedAt: v.optional(v.number()),
  submittedBy: v.optional(v.string()),
  /** The named human the current/last review waits on. */
  reviewerUserId: v.optional(v.string()),
  approvedAt: v.optional(v.number()),
  approvedBy: v.optional(v.string()),
  approvedVersions: v.array(
    v.object({
      version: v.number(),
      /** The exact blob approved — never re-pointed after approve. */
      fileId: blobRefValidator,
      contentHash: v.optional(v.string()),
      /** From `_storage` system metadata when the blob is Convex-hosted. */
      sha256: v.optional(v.string()),
      size: v.optional(v.number()),
      approvedAt: v.number(),
      approvedBy: v.string(),
    }),
  ),
});

export const controlledDocumentReplacementUploadStateValidator = v.union(
  v.literal('issued'),
  v.literal('attesting'),
  v.literal('promoted'),
  v.literal('bound'),
  v.literal('cancelled'),
  v.literal('superseded'),
  v.literal('failed'),
  v.literal('cleaned'),
);

export const controlledDocumentReplacementExpectedRecordStateValidator =
  v.union(v.literal('draft'), v.literal('approved'));

/**
 * Durable ownership and recovery record for one controlled-record replacement.
 *
 * The row exists before an upload capability is returned. S3 uploads target a
 * staging key and bind a separate server-written final key; Convex uploads bind
 * a fresh immutable `_storage` id whose content type carries `intentNonce`.
 * Cleanup keeps retry state here until every unbound object is physically gone.
 */
export const controlledDocumentReplacementUploadsTable = defineTable({
  organizationId: v.string(),
  orgSlug: v.string(),
  actorUserId: v.string(),
  actorEmail: v.string(),
  documentId: v.id('documents'),
  // Intents created before the approved-record shortcut omitted this field;
  // they retain the original draft-only meaning during the rolling upgrade.
  expectedRecordState: v.optional(
    controlledDocumentReplacementExpectedRecordStateValidator,
  ),
  expectedVersion: v.number(),
  expectedFileId: blobRefValidator,
  fileName: v.string(),
  clientContentType: v.optional(v.string()),
  lastModified: v.optional(v.number()),
  backend: v.union(v.literal('convex'), v.literal('s3')),
  intentNonce: v.string(),
  stagingRef: v.optional(blobRefValidator),
  finalRef: v.optional(blobRefValidator),
  state: controlledDocumentReplacementUploadStateValidator,
  uploadExpiresAt: v.number(),
  leaseId: v.optional(v.string()),
  leaseExpiresAt: v.optional(v.number()),
  verifiedContentType: v.optional(v.string()),
  contentHash: v.optional(v.string()),
  size: v.optional(v.number()),
  resultVersion: v.optional(v.number()),
  cleanupPending: v.boolean(),
  cleanupDueAt: v.optional(v.number()),
  cleanupAttempts: v.number(),
  lastError: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_organizationId', ['organizationId'])
  .index('by_document_state', ['documentId', 'state'])
  .index('by_stagingRef', ['stagingRef'])
  .index('by_cleanupPending_due', ['cleanupPending', 'cleanupDueAt']);

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
  /** Controlled-record lifecycle — absent for every document that never
   * opted in (the overwhelming default; see validator docstring above). */
  record: v.optional(controlledRecordValidator),
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
