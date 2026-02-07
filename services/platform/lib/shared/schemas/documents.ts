import { z } from 'zod/v4';
import { jsonRecordSchema } from './utils/json-value';

export const ragStatusLiterals = ['pending', 'queued', 'running', 'completed', 'failed', 'not_indexed', 'stale'] as const;
export const ragStatusSchema = z.enum(ragStatusLiterals);
export type RagStatus = z.infer<typeof ragStatusSchema>;

export const ragInfoStatusLiterals = ['queued', 'running', 'completed', 'failed'] as const;
export const ragInfoStatusSchema = z.enum(ragInfoStatusLiterals);
export type RagInfoStatus = z.infer<typeof ragInfoStatusSchema>;

export const sourceProviderLiterals = ['onedrive', 'upload', 'sharepoint'] as const;
export const sourceProviderSchema = z.enum(sourceProviderLiterals);
export type SourceProvider = z.infer<typeof sourceProviderSchema>;

export const sourceModeLiterals = ['auto', 'manual'] as const;
export const sourceModeSchema = z.enum(sourceModeLiterals);
export type SourceMode = z.infer<typeof sourceModeSchema>;

export const documentTypeLiterals = ['file', 'folder'] as const;
export const documentTypeSchema = z.enum(documentTypeLiterals);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const sourceTypeLiterals = ['markdown', 'html', 'url'] as const;
export const sourceTypeSchema = z.enum(sourceTypeLiterals);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const outputFormatLiterals = ['pdf', 'image'] as const;
export const outputFormatSchema = z.enum(outputFormatLiterals);
export type OutputFormat = z.infer<typeof outputFormatSchema>;

export const waitUntilLiterals = ['load', 'domcontentloaded', 'networkidle', 'commit'] as const;
export const waitUntilSchema = z.enum(waitUntilLiterals);
export type WaitUntil = z.infer<typeof waitUntilSchema>;

export const docxSectionTypeLiterals = ['heading', 'paragraph', 'bullets', 'numbered', 'table', 'quote', 'code'] as const;
export const docxSectionTypeSchema = z.enum(docxSectionTypeLiterals);
export type DocxSectionType = z.infer<typeof docxSectionTypeSchema>;

export const ragInfoSchema = z.object({
	status: ragInfoStatusSchema,
	jobId: z.string().optional(),
	indexedAt: z.number().optional(),
	error: z.string().optional(),
});
export type RagInfo = z.infer<typeof ragInfoSchema>;

export const documentItemSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	type: documentTypeSchema,
	size: z.number().optional(),
	mimeType: z.string().optional(),
	extension: z.string().optional(),
	storagePath: z.string().optional(),
	sourceProvider: sourceProviderSchema.optional(),
	sourceMode: sourceModeSchema.optional(),
	lastModified: z.number().optional(),
	syncConfigId: z.string().optional(),
	isDirectlySelected: z.boolean().optional(),
	url: z.string().optional(),
	ragStatus: ragStatusSchema.optional(),
	ragIndexedAt: z.number().optional(),
	ragError: z.string().optional(),
	teamTags: z.array(z.string()).optional(),
	createdBy: z.string().optional(),
	createdByName: z.string().optional(),
});
export type DocumentItem = z.infer<typeof documentItemSchema>;

export const paginationSchema = z.object({
	hasNextPage: z.boolean(),
	currentPage: z.number(),
	pageSize: z.number(),
});
export type Pagination = z.infer<typeof paginationSchema>;

export const documentListResponseSchema = z.object({
	success: z.boolean(),
	items: z.array(documentItemSchema),
	totalItems: z.number(),
	pagination: paginationSchema.optional(),
	error: z.string().optional(),
});
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>;

export const documentRecordSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	organizationId: z.string(),
	title: z.string().optional(),
	content: z.string().optional(),
	fileId: z.string().optional(),
	mimeType: z.string().optional(),
	extension: z.string().optional(),
	metadata: jsonRecordSchema.optional(),
	sourceProvider: sourceProviderSchema.optional(),
	externalItemId: z.string().optional(),
	ragInfo: ragInfoSchema.optional(),
});
export type DocumentRecord = z.infer<typeof documentRecordSchema>;

export const excelSheetSchema = z.object({
	name: z.string(),
	headers: z.array(z.string()),
	rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
});
export type ExcelSheet = z.infer<typeof excelSheetSchema>;

export const generateExcelResponseSchema = z.object({
	success: z.boolean(),
	fileId: z.string(),
	url: z.string(),
	fileName: z.string(),
	rowCount: z.number(),
	sheetCount: z.number(),
});
export type GenerateExcelResponse = z.infer<typeof generateExcelResponseSchema>;

export const uploadBase64ResponseSchema = z.object({
	success: z.boolean(),
	fileId: z.string(),
	url: z.string(),
	fileName: z.string(),
	size: z.number(),
	contentType: z.string(),
});
export type UploadBase64Response = z.infer<typeof uploadBase64ResponseSchema>;

export const readFileBase64ResponseSchema = z.object({
	success: z.boolean(),
	fileId: z.string(),
	dataBase64: z.string(),
	contentType: z.string(),
	size: z.number(),
});
export type ReadFileBase64Response = z.infer<typeof readFileBase64ResponseSchema>;

export const pdfOptionsSchema = z.object({
	format: z.string().optional(),
	landscape: z.boolean().optional(),
	marginTop: z.string().optional(),
	marginBottom: z.string().optional(),
	marginLeft: z.string().optional(),
	marginRight: z.string().optional(),
	printBackground: z.boolean().optional(),
});
export type PdfOptions = z.infer<typeof pdfOptionsSchema>;

export const imageOptionsSchema = z.object({
	imageType: z.string().optional(),
	quality: z.number().optional(),
	fullPage: z.boolean().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	scale: z.number().optional(),
});
export type ImageOptions = z.infer<typeof imageOptionsSchema>;

export const urlOptionsSchema = z.object({
	waitUntil: waitUntilSchema.optional(),
	timeout: z.number().optional(),
});
export type UrlOptions = z.infer<typeof urlOptionsSchema>;

export const generateDocumentResponseSchema = z.object({
	success: z.boolean(),
	fileId: z.string(),
	url: z.string(),
	fileName: z.string(),
	contentType: z.string(),
	extension: z.string(),
	size: z.number(),
});
export type GenerateDocumentResponse = z.infer<typeof generateDocumentResponseSchema>;

export const membershipSchema = z.object({
	_id: z.string(),
	organizationId: z.string(),
	identityId: z.string().optional(),
	role: z.string().optional(),
});
export type Membership = z.infer<typeof membershipSchema>;

export const signedUrlSuccessResponseSchema = z.object({
	success: z.boolean(),
	url: z.string(),
});
export type SignedUrlSuccessResponse = z.infer<typeof signedUrlSuccessResponseSchema>;

export const signedUrlErrorResponseSchema = z.object({
	success: z.boolean(),
	error: z.string(),
});
export type SignedUrlErrorResponse = z.infer<typeof signedUrlErrorResponseSchema>;

export const signedUrlResponseSchema = z.union([signedUrlSuccessResponseSchema, signedUrlErrorResponseSchema]);
export type SignedUrlResponse = z.infer<typeof signedUrlResponseSchema>;

export const documentByExtensionItemSchema = z.object({
	_id: z.string(),
	_creationTime: z.number(),
	title: z.string().optional(),
	fileId: z.string().optional(),
	mimeType: z.string().optional(),
	extension: z.string().optional(),
	metadata: jsonRecordSchema.optional(),
});
export type DocumentByExtensionItem = z.infer<typeof documentByExtensionItemSchema>;

export const deleteFromRagResponseSchema = z.object({
	success: z.boolean(),
	deletedCount: z.number(),
	deletedDataIds: z.array(z.string()),
	message: z.string(),
	error: z.string().optional(),
});
export type DeleteFromRagResponse = z.infer<typeof deleteFromRagResponseSchema>;

export const uploadFileResponseSchema = z.object({
	success: z.boolean(),
	fileId: z.string().optional(),
	documentId: z.string().optional(),
	error: z.string().optional(),
});
export type UploadFileResponse = z.infer<typeof uploadFileResponseSchema>;

export const createOneDriveSyncConfigResponseSchema = z.object({
	success: z.boolean(),
	configId: z.string().optional(),
	error: z.string().optional(),
});
export type CreateOneDriveSyncConfigResponse = z.infer<typeof createOneDriveSyncConfigResponseSchema>;

export const tableDataSchema = z.object({
	headers: z.array(z.string()),
	rows: z.array(z.array(z.string())),
});
export type TableData = z.infer<typeof tableDataSchema>;

export const slideContentSchema = z.object({
	title: z.string().optional(),
	subtitle: z.string().optional(),
	textContent: z.array(z.string()).optional(),
	bulletPoints: z.array(z.string()).optional(),
	tables: z.array(tableDataSchema).optional(),
});
export type SlideContent = z.infer<typeof slideContentSchema>;

export const pptxBrandingDataSchema = z.object({
	slideWidth: z.number().optional(),
	slideHeight: z.number().optional(),
	titleFontName: z.string().optional(),
	bodyFontName: z.string().optional(),
	titleFontSize: z.number().optional(),
	bodyFontSize: z.number().optional(),
	primaryColor: z.string().optional(),
	secondaryColor: z.string().optional(),
	accentColor: z.string().optional(),
});
export type PptxBrandingData = z.infer<typeof pptxBrandingDataSchema>;

export const generatePptxResponseSchema = z.object({
	success: z.boolean(),
	fileId: z.string(),
	url: z.string(),
	fileName: z.string(),
	contentType: z.string(),
	size: z.number(),
});
export type GeneratePptxResponse = z.infer<typeof generatePptxResponseSchema>;

export const docxSectionSchema = z.object({
	type: docxSectionTypeSchema,
	text: z.string().optional(),
	level: z.number().optional(),
	items: z.array(z.string()).optional(),
	headers: z.array(z.string()).optional(),
	rows: z.array(z.array(z.string())).optional(),
});
export type DocxSection = z.infer<typeof docxSectionSchema>;

export const docxContentSchema = z.object({
	title: z.string().optional(),
	subtitle: z.string().optional(),
	sections: z.array(docxSectionSchema),
});
export type DocxContent = z.infer<typeof docxContentSchema>;

export const generateDocxResponseSchema = z.object({
	success: z.boolean(),
	fileId: z.string(),
	url: z.string(),
	fileName: z.string(),
	contentType: z.string(),
	size: z.number(),
});
export type GenerateDocxResponse = z.infer<typeof generateDocxResponseSchema>;

export const retryRagIndexingResponseSchema = z.object({
	success: z.boolean(),
	jobId: z.string().optional(),
	error: z.string().optional(),
});
export type RetryRagIndexingResponse = z.infer<typeof retryRagIndexingResponseSchema>;

export const createDocumentFromUploadResponseSchema = z.object({
	success: z.boolean(),
	documentId: z.string().optional(),
});
export type CreateDocumentFromUploadResponse = z.infer<typeof createDocumentFromUploadResponseSchema>;
