import { z } from 'zod';

export const syncConfigStatusLiterals = ['active', 'inactive', 'error'] as const;
export const syncConfigStatusSchema = z.enum(syncConfigStatusLiterals);
export type SyncConfigStatus = z.infer<typeof syncConfigStatusSchema>;

export const onedriveItemTypeLiterals = ['file', 'folder'] as const;
export const onedriveItemTypeSchema = z.enum(onedriveItemTypeLiterals);
export type OnedriveItemType = z.infer<typeof onedriveItemTypeSchema>;

export const fileHashSchema = z.object({
	sha1Hash: z.string().optional(),
	sha256Hash: z.string().optional(),
});
export type FileHash = z.infer<typeof fileHashSchema>;

export const onedriveFileMetadataSchema = z.object({
	mimeType: z.string(),
	hashes: fileHashSchema.optional(),
});
export type OnedriveFileMetadata = z.infer<typeof onedriveFileMetadataSchema>;

export const onedriveFolderMetadataSchema = z.object({
	childCount: z.number(),
});
export type OnedriveFolderMetadata = z.infer<typeof onedriveFolderMetadataSchema>;

export const parentReferenceSchema = z.object({
	driveId: z.string(),
	driveType: z.string(),
	id: z.string(),
	path: z.string(),
});
export type ParentReference = z.infer<typeof parentReferenceSchema>;

export const driveItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	size: z.number().optional(),
	createdDateTime: z.string(),
	lastModifiedDateTime: z.string(),
	webUrl: z.string(),
	downloadUrl: z.string().optional(),
	file: onedriveFileMetadataSchema.optional(),
	folder: onedriveFolderMetadataSchema.optional(),
	parentReference: parentReferenceSchema.optional(),
});
export type DriveItem = z.infer<typeof driveItemSchema>;

export const driveItemsResponseSchema = z.object({
	nextLink: z.string().optional(),
	value: z.array(driveItemSchema),
});
export type DriveItemsResponse = z.infer<typeof driveItemsResponseSchema>;

export const fileItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	size: z.number(),
	mimeType: z.string().optional(),
	lastModified: z.number().optional(),
	isFolder: z.boolean(),
});
export type FileItem = z.infer<typeof fileItemSchema>;

export const listFilesResponseSchema = z.object({
	success: z.boolean(),
	data: driveItemsResponseSchema.optional(),
	error: z.string().optional(),
});
export type ListFilesResponse = z.infer<typeof listFilesResponseSchema>;

export const listFolderContentsResponseSchema = z.object({
	success: z.boolean(),
	files: z.array(fileItemSchema).optional(),
	error: z.string().optional(),
});
export type ListFolderContentsResponse = z.infer<typeof listFolderContentsResponseSchema>;

export const uploadToStorageResponseSchema = z.object({
	success: z.boolean(),
	fileId: z.string().optional(),
	documentId: z.string().optional(),
	error: z.string().optional(),
});
export type UploadToStorageResponse = z.infer<typeof uploadToStorageResponseSchema>;

export const refreshTokenResponseSchema = z.object({
	success: z.boolean(),
	accessToken: z.string().optional(),
	error: z.string().optional(),
});
export type RefreshTokenResponse = z.infer<typeof refreshTokenResponseSchema>;

export const getUserTokenResponseSchema = z.object({
	token: z.string().nullable(),
	needsRefresh: z.boolean(),
	accountId: z.string().nullable(),
	refreshToken: z.string().nullable(),
});
export type GetUserTokenResponse = z.infer<typeof getUserTokenResponseSchema>;
