/**
 * Convex validators for OneDrive operations
 * Generated from shared Zod schemas using zodToConvex
 */

import { zodToConvex } from 'convex-helpers/server/zod4';
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
export const listFolderContentsResponseValidator = zodToConvex(listFolderContentsResponseSchema);
export const uploadToStorageResponseValidator = zodToConvex(uploadToStorageResponseSchema);
export const refreshTokenResponseValidator = zodToConvex(refreshTokenResponseSchema);
export const getUserTokenResponseValidator = zodToConvex(getUserTokenResponseSchema);
