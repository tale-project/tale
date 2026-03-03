/**
 * Convex validators for OneDrive operations
 */

import { v } from 'convex/values';

export const syncConfigStatusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
);

export const onedriveItemTypeValidator = v.union(
  v.literal('file'),
  v.literal('folder'),
);

const fileHashValidator = v.object({
  sha1Hash: v.optional(v.string()),
  sha256Hash: v.optional(v.string()),
});

const onedriveFileMetadataValidator = v.object({
  mimeType: v.string(),
  hashes: v.optional(fileHashValidator),
});

const onedriveFolderMetadataValidator = v.object({
  childCount: v.number(),
});

const parentReferenceValidator = v.object({
  driveId: v.string(),
  driveType: v.string(),
  id: v.string(),
  path: v.string(),
});

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

export const fileItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  size: v.number(),
  mimeType: v.optional(v.string()),
  lastModified: v.optional(v.number()),
  isFolder: v.boolean(),
});

const driveItemsResponseValidator = v.object({
  nextLink: v.optional(v.string()),
  value: v.array(driveItemValidator),
});

export const listFilesResponseValidator = v.object({
  success: v.boolean(),
  data: v.optional(driveItemsResponseValidator),
  error: v.optional(v.string()),
});

export const listFolderContentsResponseValidator = v.object({
  success: v.boolean(),
  files: v.optional(v.array(fileItemValidator)),
  error: v.optional(v.string()),
});

export const uploadToStorageResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.optional(v.string()),
  documentId: v.optional(v.string()),
  error: v.optional(v.string()),
});

export const refreshTokenResponseValidator = v.object({
  success: v.boolean(),
  accessToken: v.optional(v.string()),
  error: v.optional(v.string()),
});

export const getUserTokenResponseValidator = v.object({
  token: v.union(v.string(), v.null()),
  needsRefresh: v.boolean(),
  accountId: v.union(v.string(), v.null()),
  refreshToken: v.union(v.string(), v.null()),
});

export const oneDriveItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  size: v.number(),
  isFolder: v.boolean(),
  mimeType: v.optional(v.string()),
  lastModified: v.optional(v.number()),
  childCount: v.optional(v.number()),
  webUrl: v.optional(v.string()),
});

export const importItemValidator = v.object({
  id: v.string(),
  name: v.string(),
  size: v.number(),
  relativePath: v.optional(v.string()),
  isDirectlySelected: v.optional(v.boolean()),
  selectedParentId: v.optional(v.string()),
  selectedParentName: v.optional(v.string()),
  selectedParentPath: v.optional(v.string()),
  siteId: v.optional(v.string()),
  driveId: v.optional(v.string()),
  sourceType: v.optional(
    v.union(v.literal('onedrive'), v.literal('sharepoint')),
  ),
});

export const importFileResultValidator = v.object({
  fileId: v.string(),
  fileName: v.string(),
  status: v.union(
    v.literal('success'),
    v.literal('skipped'),
    v.literal('error'),
  ),
  documentId: v.optional(v.id('documents')),
  error: v.optional(v.string()),
});

export const sharePointSiteValidator = v.object({
  id: v.string(),
  name: v.string(),
  displayName: v.string(),
  webUrl: v.string(),
  description: v.optional(v.string()),
});

export const sharePointDriveValidator = v.object({
  id: v.string(),
  name: v.string(),
  driveType: v.string(),
  webUrl: v.optional(v.string()),
  description: v.optional(v.string()),
});
