/**
 * Convex validators for document operations
 */

import { v } from 'convex/values';

import { jsonRecordValidator } from '../lib/validators/json';

/**
 * Source provider for a document.
 *
 * Open string by design — for connector-sourced documents this is the
 * connector slug (e.g. `onedrive`, `sharepoint`, `google_drive`). New
 * connectors don't require platform code changes.
 *
 * Reserved (non-connector) values:
 * - `upload` — user-uploaded file with no connector backing
 * - `agent` — created by an AI agent
 * - `webdav` — created/uploaded via the WebDAV server
 */
export const sourceProviderValidator = v.string();

export const sourceModeValidator = v.union(
  v.literal('auto'),
  v.literal('manual'),
);

export const ragStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  // Terminal, non-retryable: no text extractor exists for this format.
  v.literal('unsupported'),
  v.literal('not_indexed'),
  v.literal('stale'),
);

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
  folderId: v.optional(v.string()),
  sourceProvider: v.optional(sourceProviderValidator),
  sourceMode: v.optional(sourceModeValidator),
  lastModified: v.optional(v.number()),
  uploadedAt: v.optional(v.number()),
  sourceCreatedAt: v.optional(v.number()),
  sourceModifiedAt: v.optional(v.number()),
  syncConfigId: v.optional(v.string()),
  isDirectlySelected: v.optional(v.boolean()),
  url: v.optional(v.string()),
  ragStatus: v.optional(ragStatusValidator),
  ragIndexedAt: v.optional(v.number()),
  ragError: v.optional(v.string()),
  ragErrorCode: v.optional(v.string()),
  scannedPagesDetected: v.optional(v.number()),
  ocrApplied: v.optional(v.boolean()),
  teamId: v.optional(v.union(v.string(), v.null())),
  teamIds: v.optional(v.array(v.string())),
  createdBy: v.optional(v.string()),
  createdByName: v.optional(v.string()),
  /** Controlled-record projection (documents/records.ts) — absent for
   * documents that never opted in. */
  record: v.optional(
    v.object({
      state: v.union(
        v.literal('draft'),
        v.literal('in_review'),
        v.literal('approved'),
      ),
      version: v.number(),
      /** Current blob identity used as the draft replacement CAS token. */
      currentFileId: v.optional(v.string()),
      reviewerUserId: v.optional(v.string()),
      /** Resolved display name of the reviewer the pending review waits on. */
      reviewerName: v.optional(v.string()),
    }),
  ),
});

export const documentFindResponseValidator = v.object({
  success: v.boolean(),
  items: v.array(documentItemValidator),
  totalItems: v.number(),
  pagination: v.optional(paginationValidator),
  error: v.optional(v.string()),
});

export const generateDocumentResponseValidator = v.object({
  success: v.boolean(),
  fileStorageId: v.string(),
  downloadUrl: v.string(),
  fileName: v.string(),
  contentType: v.string(),
  extension: v.string(),
  size: v.number(),
});

export const generateDocxResponseValidator = v.object({
  success: v.boolean(),
  fileStorageId: v.string(),
  downloadUrl: v.string(),
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
  folderId: v.optional(v.string()),
  folderPath: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
  sourceProvider: v.optional(sourceProviderValidator),
  externalItemId: v.optional(v.string()),
  sourceCreatedAt: v.optional(v.number()),
  sourceModifiedAt: v.optional(v.number()),
});
