/**
 * Convex validators for OneDrive operations
 */

import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  syncConfigStatusSchema,
  onedriveItemTypeSchema,
  fileHashSchema,
  onedriveFileMetadataSchema,
  onedriveFolderMetadataSchema,
  parentReferenceSchema,
  driveItemSchema,
  driveItemsResponseSchema,
  fileItemSchema,
  listFilesResponseSchema,
  listFolderContentsResponseSchema,
  uploadToStorageResponseSchema,
  refreshTokenResponseSchema,
  getUserTokenResponseSchema,
} from '../../lib/shared/schemas/onedrive';

export const syncConfigStatusValidator = zodToConvex(syncConfigStatusSchema);
export const onedriveItemTypeValidator = zodToConvex(onedriveItemTypeSchema);
export const fileHashValidator = zodToConvex(fileHashSchema);
export const onedriveFileMetadataValidator = zodToConvex(onedriveFileMetadataSchema);
export const onedriveFolderMetadataValidator = zodToConvex(onedriveFolderMetadataSchema);
export const parentReferenceValidator = zodToConvex(parentReferenceSchema);
export const driveItemValidator = zodToConvex(driveItemSchema);
export const driveItemsResponseValidator = zodToConvex(driveItemsResponseSchema);
export const fileItemValidator = zodToConvex(fileItemSchema);
export const listFilesResponseValidator = zodToConvex(listFilesResponseSchema);
export const listFolderContentsResponseValidator = zodToConvex(listFolderContentsResponseSchema);
export const uploadToStorageResponseValidator = zodToConvex(uploadToStorageResponseSchema);
export const refreshTokenResponseValidator = zodToConvex(refreshTokenResponseSchema);
export const getUserTokenResponseValidator = zodToConvex(getUserTokenResponseSchema);

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

export const readFileFromOnedriveResponseValidator = v.object({
  success: v.boolean(),
  content: v.optional(v.bytes()),
  mimeType: v.optional(v.string()),
  size: v.optional(v.number()),
  error: v.optional(v.string()),
});
