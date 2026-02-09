import { zodToConvex } from 'convex-helpers/server/zod4';
import { v } from 'convex/values';

import {
  syncConfigStatusSchema,
  onedriveItemTypeSchema,
  driveItemSchema,
  fileItemSchema,
  listFilesResponseSchema,
  listFolderContentsResponseSchema,
  uploadToStorageResponseSchema,
  refreshTokenResponseSchema,
  getUserTokenResponseSchema,
} from '../../lib/shared/schemas/onedrive';

export {
  syncConfigStatusSchema,
  onedriveItemTypeSchema,
  driveItemSchema,
  fileItemSchema,
} from '../../lib/shared/schemas/onedrive';

export const syncConfigStatusValidator = zodToConvex(syncConfigStatusSchema);
export const onedriveItemTypeValidator = zodToConvex(onedriveItemTypeSchema);
export const driveItemValidator = zodToConvex(driveItemSchema);
export const fileItemValidator = zodToConvex(fileItemSchema);
export const listFilesResponseValidator = zodToConvex(listFilesResponseSchema);
export const listFolderContentsResponseValidator = zodToConvex(
  listFolderContentsResponseSchema,
);
export const uploadToStorageResponseValidator = zodToConvex(
  uploadToStorageResponseSchema,
);
export const refreshTokenResponseValidator = zodToConvex(
  refreshTokenResponseSchema,
);
export const getUserTokenResponseValidator = zodToConvex(
  getUserTokenResponseSchema,
);

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
