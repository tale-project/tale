import { z } from 'zod/v4';

import { jsonRecordSchema } from './utils/json-value';

const ragStatusLiterals = [
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
  'not_indexed',
  'stale',
] as const;
export const ragStatusSchema = z.enum(ragStatusLiterals);
type RagStatus = z.infer<typeof ragStatusSchema>;

const ragInfoStatusLiterals = [
  'queued',
  'running',
  'completed',
  'failed',
] as const;
export const ragInfoStatusSchema = z.enum(ragInfoStatusLiterals);
type RagInfoStatus = z.infer<typeof ragInfoStatusSchema>;

const sourceProviderLiterals = ['onedrive', 'upload', 'sharepoint'] as const;
export const sourceProviderSchema = z.enum(sourceProviderLiterals);
type SourceProvider = z.infer<typeof sourceProviderSchema>;

const sourceModeLiterals = ['auto', 'manual'] as const;
export const sourceModeSchema = z.enum(sourceModeLiterals);
type SourceMode = z.infer<typeof sourceModeSchema>;

const documentTypeLiterals = ['file', 'folder'] as const;
const documentTypeSchema = z.enum(documentTypeLiterals);
type DocumentType = z.infer<typeof documentTypeSchema>;

const sourceTypeLiterals = ['markdown', 'html', 'url'] as const;
const sourceTypeSchema = z.enum(sourceTypeLiterals);
type SourceType = z.infer<typeof sourceTypeSchema>;

const outputFormatLiterals = ['pdf', 'image'] as const;
const outputFormatSchema = z.enum(outputFormatLiterals);
type OutputFormat = z.infer<typeof outputFormatSchema>;

const waitUntilLiterals = [
  'load',
  'domcontentloaded',
  'networkidle',
  'commit',
] as const;
const waitUntilSchema = z.enum(waitUntilLiterals);
type WaitUntil = z.infer<typeof waitUntilSchema>;

const docxSectionTypeLiterals = [
  'heading',
  'paragraph',
  'bullets',
  'numbered',
  'table',
  'quote',
  'code',
] as const;
const docxSectionTypeSchema = z.enum(docxSectionTypeLiterals);
type DocxSectionType = z.infer<typeof docxSectionTypeSchema>;

export const ragInfoSchema = z.object({
  status: ragInfoStatusSchema,
  jobId: z.string().optional(),
  indexedAt: z.number().optional(),
  error: z.string().optional(),
});
type RagInfo = z.infer<typeof ragInfoSchema>;

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
type DocumentItem = z.infer<typeof documentItemSchema>;

const paginationSchema = z.object({
  hasNextPage: z.boolean(),
  currentPage: z.number(),
  pageSize: z.number(),
});
type Pagination = z.infer<typeof paginationSchema>;

export const documentListResponseSchema = z.object({
  success: z.boolean(),
  items: z.array(documentItemSchema),
  totalItems: z.number(),
  pagination: paginationSchema.optional(),
  error: z.string().optional(),
});
type DocumentListResponse = z.infer<typeof documentListResponseSchema>;

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
type DocumentRecord = z.infer<typeof documentRecordSchema>;

const excelSheetSchema = z.object({
  name: z.string(),
  headers: z.array(z.string()),
  rows: z.array(
    z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  ),
});
type ExcelSheet = z.infer<typeof excelSheetSchema>;

const generateExcelResponseSchema = z.object({
  success: z.boolean(),
  fileId: z.string(),
  url: z.string(),
  fileName: z.string(),
  rowCount: z.number(),
  sheetCount: z.number(),
});
type GenerateExcelResponse = z.infer<typeof generateExcelResponseSchema>;

const uploadBase64ResponseSchema = z.object({
  success: z.boolean(),
  fileId: z.string(),
  url: z.string(),
  fileName: z.string(),
  size: z.number(),
  contentType: z.string(),
});
type UploadBase64Response = z.infer<typeof uploadBase64ResponseSchema>;

const readFileBase64ResponseSchema = z.object({
  success: z.boolean(),
  fileId: z.string(),
  dataBase64: z.string(),
  contentType: z.string(),
  size: z.number(),
});
type ReadFileBase64Response = z.infer<typeof readFileBase64ResponseSchema>;

const pdfOptionsSchema = z.object({
  format: z.string().optional(),
  landscape: z.boolean().optional(),
  marginTop: z.string().optional(),
  marginBottom: z.string().optional(),
  marginLeft: z.string().optional(),
  marginRight: z.string().optional(),
  printBackground: z.boolean().optional(),
});
type PdfOptions = z.infer<typeof pdfOptionsSchema>;

const imageOptionsSchema = z.object({
  imageType: z.string().optional(),
  quality: z.number().optional(),
  fullPage: z.boolean().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  scale: z.number().optional(),
});
type ImageOptions = z.infer<typeof imageOptionsSchema>;

const urlOptionsSchema = z.object({
  waitUntil: waitUntilSchema.optional(),
  timeout: z.number().optional(),
});
type UrlOptions = z.infer<typeof urlOptionsSchema>;

export const generateDocumentResponseSchema = z.object({
  success: z.boolean(),
  fileId: z.string(),
  url: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  extension: z.string(),
  size: z.number(),
});
type GenerateDocumentResponse = z.infer<typeof generateDocumentResponseSchema>;

const membershipSchema = z.object({
  _id: z.string(),
  organizationId: z.string(),
  identityId: z.string().optional(),
  role: z.string().optional(),
});
type Membership = z.infer<typeof membershipSchema>;

const signedUrlSuccessResponseSchema = z.object({
  success: z.boolean(),
  url: z.string(),
});
type SignedUrlSuccessResponse = z.infer<typeof signedUrlSuccessResponseSchema>;

const signedUrlErrorResponseSchema = z.object({
  success: z.boolean(),
  error: z.string(),
});
type SignedUrlErrorResponse = z.infer<typeof signedUrlErrorResponseSchema>;

const signedUrlResponseSchema = z.union([
  signedUrlSuccessResponseSchema,
  signedUrlErrorResponseSchema,
]);
type SignedUrlResponse = z.infer<typeof signedUrlResponseSchema>;

const documentByExtensionItemSchema = z.object({
  _id: z.string(),
  _creationTime: z.number(),
  title: z.string().optional(),
  fileId: z.string().optional(),
  mimeType: z.string().optional(),
  extension: z.string().optional(),
  metadata: jsonRecordSchema.optional(),
});
type DocumentByExtensionItem = z.infer<typeof documentByExtensionItemSchema>;

const deleteFromRagResponseSchema = z.object({
  success: z.boolean(),
  deletedCount: z.number(),
  deletedDataIds: z.array(z.string()),
  message: z.string(),
  error: z.string().optional(),
});
type DeleteFromRagResponse = z.infer<typeof deleteFromRagResponseSchema>;

export const uploadFileResponseSchema = z.object({
  success: z.boolean(),
  fileId: z.string().optional(),
  documentId: z.string().optional(),
  error: z.string().optional(),
});
type UploadFileResponse = z.infer<typeof uploadFileResponseSchema>;

const createOneDriveSyncConfigResponseSchema = z.object({
  success: z.boolean(),
  configId: z.string().optional(),
  error: z.string().optional(),
});
type CreateOneDriveSyncConfigResponse = z.infer<
  typeof createOneDriveSyncConfigResponseSchema
>;

const tableDataSchema = z.object({
  headers: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});
type TableData = z.infer<typeof tableDataSchema>;

const slideContentSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  textContent: z.array(z.string()).optional(),
  bulletPoints: z.array(z.string()).optional(),
  tables: z.array(tableDataSchema).optional(),
});
type SlideContent = z.infer<typeof slideContentSchema>;

const pptxBrandingDataSchema = z.object({
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
type PptxBrandingData = z.infer<typeof pptxBrandingDataSchema>;

export const generatePptxResponseSchema = z.object({
  success: z.boolean(),
  fileId: z.string(),
  url: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  size: z.number(),
});
type GeneratePptxResponse = z.infer<typeof generatePptxResponseSchema>;

const docxSectionSchema = z.object({
  type: docxSectionTypeSchema,
  text: z.string().optional(),
  level: z.number().optional(),
  items: z.array(z.string()).optional(),
  headers: z.array(z.string()).optional(),
  rows: z.array(z.array(z.string())).optional(),
});
type DocxSection = z.infer<typeof docxSectionSchema>;

const docxContentSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  sections: z.array(docxSectionSchema),
});
type DocxContent = z.infer<typeof docxContentSchema>;

export const generateDocxResponseSchema = z.object({
  success: z.boolean(),
  fileId: z.string(),
  url: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  size: z.number(),
});
type GenerateDocxResponse = z.infer<typeof generateDocxResponseSchema>;

const retryRagIndexingResponseSchema = z.object({
  success: z.boolean(),
  jobId: z.string().optional(),
  error: z.string().optional(),
});
type RetryRagIndexingResponse = z.infer<typeof retryRagIndexingResponseSchema>;

const createDocumentFromUploadResponseSchema = z.object({
  success: z.boolean(),
  documentId: z.string().optional(),
});
type CreateDocumentFromUploadResponse = z.infer<
  typeof createDocumentFromUploadResponseSchema
>;
