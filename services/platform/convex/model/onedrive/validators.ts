/**
 * Convex validators for OneDrive model
 */

import { v } from 'convex/values';

/**
 * OneDrive sync config status validator
 */
export const syncConfigStatusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
);

/**
 * OneDrive item type validator
 */
export const onedriveItemTypeValidator = v.union(
  v.literal('file'),
  v.literal('folder'),
);

/**
 * File hash validator for OneDrive files
 */
export const fileHashValidator = v.object({
  sha1Hash: v.optional(v.string()),
  sha256Hash: v.optional(v.string()),
  quickXorHash: v.optional(v.string()),
});

/**
 * File metadata validator for OneDrive files
 */
export const onedriveFileMetadataValidator = v.object({
  mimeType: v.string(),
  hashes: v.optional(fileHashValidator),
});

/**
 * Folder metadata validator for OneDrive folders
 */
export const onedriveFolderMetadataValidator = v.object({
  childCount: v.number(),
});

/**
 * Parent reference validator for OneDrive items
 */
export const parentReferenceValidator = v.object({
  driveId: v.string(),
  driveType: v.string(),
  id: v.string(),
  path: v.string(),
  name: v.optional(v.string()),
  siteId: v.optional(v.string()),
});

/**
 * Drive item validator (single OneDrive item)
 */
export const driveItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  size: v.optional(v.number()),
  createdDateTime: v.string(),
  lastModifiedDateTime: v.string(),
  webUrl: v.string(),
  downloadUrl: v.optional(v.string()),
  file: v.optional(onedriveFileMetadataValidator),
  folder: v.optional(onedriveFolderMetadataValidator),
  parentReference: v.optional(parentReferenceValidator),
});

/**
 * Drive items response validator (paginated list of items)
 */
export const driveItemsResponseValidator = v.object({
  nextLink: v.optional(v.string()),
  value: v.array(driveItemValidator),
});

/**
 * File item validator (simplified for folder contents listing)
 */
export const fileItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  size: v.number(),
  mimeType: v.optional(v.string()),
  lastModified: v.optional(v.number()),
  isFolder: v.boolean(),
});

/**
 * List files response validator
 */
export const listFilesResponseValidator = v.object({
  success: v.boolean(),
  data: v.optional(driveItemsResponseValidator),
  error: v.optional(v.string()),
});

/**
 * Read file response validator
 */
export const readFileResponseValidator = v.object({
  success: v.boolean(),
  data: v.optional(
    v.object({
      content: v.bytes(),
      mimeType: v.string(),
      size: v.number(),
    }),
  ),
  error: v.optional(v.string()),
});

/**
 * Read file from OneDrive response validator (internal action)
 */
export const readFileFromOnedriveResponseValidator = v.object({
  success: v.boolean(),
  content: v.optional(v.bytes()),
  mimeType: v.optional(v.string()),
  size: v.optional(v.number()),
  error: v.optional(v.string()),
});

/**
 * List folder contents response validator (internal action)
 */
export const listFolderContentsResponseValidator = v.object({
  success: v.boolean(),
  files: v.optional(v.array(fileItemValidator)),
  error: v.optional(v.string()),
});

/**
 * Upload to storage response validator (internal action)
 */
export const uploadToStorageResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.optional(v.string()),
  documentId: v.optional(v.string()),
  error: v.optional(v.string()),
});

/**
 * Refresh token response validator
 */
export const refreshTokenResponseValidator = v.object({
  success: v.boolean(),
  accessToken: v.optional(v.string()),
  error: v.optional(v.string()),
});

/**
 * Get user token response validator (internal query)
 */
export const getUserTokenResponseValidator = v.object({
  token: v.union(v.string(), v.null()),
  needsRefresh: v.boolean(),
  accountId: v.union(v.string(), v.null()),
  refreshToken: v.union(v.string(), v.null()),
});
