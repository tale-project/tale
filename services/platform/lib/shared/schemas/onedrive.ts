import { z } from 'zod/v4';

const syncConfigStatusLiterals = ['active', 'inactive', 'error'] as const;
export const syncConfigStatusSchema = z.enum(syncConfigStatusLiterals);
type SyncConfigStatus = z.infer<typeof syncConfigStatusSchema>;

const onedriveItemTypeLiterals = ['file', 'folder'] as const;
export const onedriveItemTypeSchema = z.enum(onedriveItemTypeLiterals);
type OnedriveItemType = z.infer<typeof onedriveItemTypeSchema>;

const fileHashSchema = z.object({
	sha1Hash: z.string().optional(),
	sha256Hash: z.string().optional(),
});
type FileHash = z.infer<typeof fileHashSchema>;

const onedriveFileMetadataSchema = z.object({
	mimeType: z.string(),
	hashes: fileHashSchema.optional(),
});
type OnedriveFileMetadata = z.infer<typeof onedriveFileMetadataSchema>;

const onedriveFolderMetadataSchema = z.object({
	childCount: z.number(),
});
type OnedriveFolderMetadata = z.infer<typeof onedriveFolderMetadataSchema>;

const parentReferenceSchema = z.object({
	driveId: z.string(),
	driveType: z.string(),
	id: z.string(),
	path: z.string(),
});
type ParentReference = z.infer<typeof parentReferenceSchema>;

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
type DriveItem = z.infer<typeof driveItemSchema>;

const driveItemsResponseSchema = z.object({
	nextLink: z.string().optional(),
	value: z.array(driveItemSchema),
});
type DriveItemsResponse = z.infer<typeof driveItemsResponseSchema>;

export const fileItemSchema = z.object({
	id: z.string(),
	name: z.string(),
	size: z.number(),
	mimeType: z.string().optional(),
	lastModified: z.number().optional(),
	isFolder: z.boolean(),
});
type FileItem = z.infer<typeof fileItemSchema>;

export const listFilesResponseSchema = z.object({
	success: z.boolean(),
	data: driveItemsResponseSchema.optional(),
	error: z.string().optional(),
});
type ListFilesResponse = z.infer<typeof listFilesResponseSchema>;

export const listFolderContentsResponseSchema = z.object({
	success: z.boolean(),
	files: z.array(fileItemSchema).optional(),
	error: z.string().optional(),
});
type ListFolderContentsResponse = z.infer<typeof listFolderContentsResponseSchema>;

export const uploadToStorageResponseSchema = z.object({
	success: z.boolean(),
	fileId: z.string().optional(),
	documentId: z.string().optional(),
	error: z.string().optional(),
});
type UploadToStorageResponse = z.infer<typeof uploadToStorageResponseSchema>;

export const refreshTokenResponseSchema = z.object({
	success: z.boolean(),
	accessToken: z.string().optional(),
	error: z.string().optional(),
});
type RefreshTokenResponse = z.infer<typeof refreshTokenResponseSchema>;

export const getUserTokenResponseSchema = z.object({
	token: z.string().nullable(),
	needsRefresh: z.boolean(),
	accountId: z.string().nullable(),
	refreshToken: z.string().nullable(),
});
type GetUserTokenResponse = z.infer<typeof getUserTokenResponseSchema>;

const readFileResponseDataSchema = z.object({
	content: z.instanceof(ArrayBuffer),
	mimeType: z.string(),
	size: z.number(),
});
type ReadFileResponseData = z.infer<typeof readFileResponseDataSchema>;

const readFileResponseSchema = z.object({
	success: z.boolean(),
	data: readFileResponseDataSchema.optional(),
	error: z.string().optional(),
});
type ReadFileResponse = z.infer<typeof readFileResponseSchema>;

const readFileFromOnedriveResponseSchema = z.object({
	success: z.boolean(),
	content: z.instanceof(ArrayBuffer).optional(),
	mimeType: z.string().optional(),
	size: z.number().optional(),
	error: z.string().optional(),
});
type ReadFileFromOnedriveResponse = z.infer<typeof readFileFromOnedriveResponseSchema>;
