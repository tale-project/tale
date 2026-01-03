/**
 * Convex validators for document model
 */

import { v } from 'convex/values';

export { sortOrderValidator } from '../common/validators';

/**
 * RAG status validator
 */
export const ragStatusValidator = v.union(
  v.literal('pending'),
  v.literal('queued'),
  v.literal('running'),
  v.literal('completed'),
  v.literal('failed'),
  v.literal('not_indexed'),
  v.literal('stale'),
);

/**
 * RAG info validator - stored status of document in RAG service
 */
export const ragInfoValidator = v.object({
  status: v.union(
    v.literal('queued'),
    v.literal('running'),
    v.literal('completed'),
    v.literal('failed'),
  ),
  jobId: v.optional(v.string()),
  indexedAt: v.optional(v.number()),
  error: v.optional(v.string()),
});

/**
 * Source provider validator
 */
export const sourceProviderValidator = v.union(
  v.literal('onedrive'),
  v.literal('upload'),
);

/**
 * Source mode validator
 */
export const sourceModeValidator = v.union(
  v.literal('auto'),
  v.literal('manual'),
);

/**
 * Document type validator
 */
export const documentTypeValidator = v.union(
  v.literal('file'),
  v.literal('folder'),
);

/**
 * Document item validator (for public API responses)
 */
export const documentItemValidator = v.object({
  id: v.string(),
  name: v.optional(v.string()),
  type: documentTypeValidator,
  size: v.optional(v.number()),
  mimeType: v.optional(v.string()),
  extension: v.optional(v.string()),
  storagePath: v.optional(v.string()),
  sourceProvider: v.optional(sourceProviderValidator),
  sourceMode: v.optional(sourceModeValidator),
  lastModified: v.optional(v.number()),
  syncConfigId: v.optional(v.string()),
  isDirectlySelected: v.optional(v.boolean()),
  url: v.optional(v.string()),
  ragStatus: v.optional(ragStatusValidator),
  ragIndexedAt: v.optional(v.number()),
  ragError: v.optional(v.string()),
});

/**
 * Pagination validator
 */
export const paginationValidator = v.object({
  hasNextPage: v.boolean(),
  currentPage: v.number(),
  pageSize: v.number(),
});

/**
 * Document list response validator
 */
export const documentListResponseValidator = v.object({
  success: v.boolean(),
  items: v.array(documentItemValidator),
  totalItems: v.number(),
  pagination: v.optional(paginationValidator),
  error: v.optional(v.string()),
});

/**
 * Document record validator (raw database document)
 */
export const documentRecordValidator = v.object({
  _id: v.id('documents'),
  _creationTime: v.number(),
  organizationId: v.string(),
  title: v.optional(v.string()),

  content: v.optional(v.string()),
  fileId: v.optional(v.id('_storage')),
  mimeType: v.optional(v.string()),
  extension: v.optional(v.string()),
  metadata: v.optional(v.any()),
  sourceProvider: v.optional(sourceProviderValidator),
  externalItemId: v.optional(v.string()),
  ragInfo: v.optional(ragInfoValidator),
});

/**
 * Excel sheet validator (for generateExcelInternal)
 */
export const excelSheetValidator = v.object({
  name: v.string(),
  headers: v.array(v.string()),
  rows: v.array(
    v.array(v.union(v.string(), v.number(), v.boolean(), v.null())),
  ),
});

/**
 * Generate Excel response validator
 */
export const generateExcelResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.id('_storage'),
  url: v.string(),
  fileName: v.string(),
  rowCount: v.number(),
  sheetCount: v.number(),
});

/**
 * Upload base64 response validator
 */
export const uploadBase64ResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.id('_storage'),
  url: v.string(),
  fileName: v.string(),
  size: v.number(),
  contentType: v.string(),
});

/**
 * Read file base64 response validator
 */
export const readFileBase64ResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.id('_storage'),
  dataBase64: v.string(),
  contentType: v.string(),
  size: v.number(),
});

/**
 * Source type validator (for document generation)
 */
export const sourceTypeValidator = v.union(
  v.literal('markdown'),
  v.literal('html'),
  v.literal('url'),
);

/**
 * Output format validator (for document generation)
 */
export const outputFormatValidator = v.union(
  v.literal('pdf'),
  v.literal('image'),
);

/**
 * PDF options validator
 */
export const pdfOptionsValidator = v.object({
  format: v.optional(v.string()),
  landscape: v.optional(v.boolean()),
  marginTop: v.optional(v.string()),
  marginBottom: v.optional(v.string()),
  marginLeft: v.optional(v.string()),
  marginRight: v.optional(v.string()),
  printBackground: v.optional(v.boolean()),
});

/**
 * Image options validator
 */
export const imageOptionsValidator = v.object({
  imageType: v.optional(v.string()),
  quality: v.optional(v.number()),
  fullPage: v.optional(v.boolean()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  scale: v.optional(v.number()),
});

/**
 * Wait until validator for URL options
 */
export const waitUntilValidator = v.union(
  v.literal('load'),
  v.literal('domcontentloaded'),
  v.literal('networkidle'),
  v.literal('commit'),
);

/**
 * URL options validator
 */
export const urlOptionsValidator = v.object({
  waitUntil: v.optional(waitUntilValidator),
  timeout: v.optional(v.number()),
});

/**
 * Generate document response validator
 */
export const generateDocumentResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.id('_storage'),
  url: v.string(),
  fileName: v.string(),
  contentType: v.string(),
  extension: v.string(),
  size: v.number(),
});

/**
 * Membership validator (for checkMembership)
 */
export const membershipValidator = v.object({
  _id: v.string(),
  organizationId: v.string(),
  identityId: v.optional(v.string()),
  role: v.optional(v.string()),
});

/**
 * Signed URL response validator
 */
export const signedUrlResponseValidator = v.union(
  v.object({
    success: v.boolean(),
    url: v.string(),
  }),
  v.object({
    success: v.boolean(),
    error: v.string(),
  }),
);

/**
 * Document by extension item validator
 */
export const documentByExtensionItemValidator = v.object({
  _id: v.id('documents'),
  _creationTime: v.number(),
  title: v.optional(v.string()),
  fileId: v.optional(v.id('_storage')),
  mimeType: v.optional(v.string()),
  extension: v.optional(v.string()),
  metadata: v.optional(v.any()),
});

/**
 * Delete from RAG response validator
 */
export const deleteFromRagResponseValidator = v.object({
  success: v.boolean(),
  deletedCount: v.number(),
  deletedDataIds: v.array(v.string()),
  message: v.string(),
  error: v.optional(v.string()),
});

/**
 * Upload file response validator
 */
export const uploadFileResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.optional(v.string()),
  documentId: v.optional(v.string()),
  error: v.optional(v.string()),
});

/**
 * Create OneDrive sync config response validator
 */
export const createOneDriveSyncConfigResponseValidator = v.object({
  success: v.boolean(),
  configId: v.optional(v.string()),
  error: v.optional(v.string()),
});

/**
 * Text content info validator (for PPTX analysis)
 */
export const textContentInfoValidator = v.object({
  text: v.string(),
  isPlaceholder: v.boolean(),
});

/**
 * Table info validator (for PPTX analysis)
 */
export const tableInfoValidator = v.object({
  rowCount: v.number(),
  columnCount: v.number(),
  headers: v.array(v.string()),
  rows: v.array(v.array(v.string())),
});

/**
 * Chart info validator (for PPTX analysis)
 */
export const chartInfoValidator = v.object({
  chartType: v.string(),
  hasLegend: v.optional(v.boolean()),
  seriesCount: v.optional(v.number()),
});

/**
 * Image info validator (for PPTX analysis)
 */
export const imageInfoValidator = v.object({
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});

/**
 * Slide info validator (for PPTX analysis)
 */
export const slideInfoValidator = v.object({
  slideNumber: v.number(),
  layoutName: v.string(),
  title: v.union(v.string(), v.null()),
  subtitle: v.union(v.string(), v.null()),
  textContent: v.array(textContentInfoValidator),
  tables: v.array(tableInfoValidator),
  charts: v.array(chartInfoValidator),
  images: v.array(imageInfoValidator),
});

/**
 * Branding info validator (for PPTX analysis)
 */
export const brandingInfoValidator = v.object({
  slideWidth: v.optional(v.number()),
  slideHeight: v.optional(v.number()),
  titleFontName: v.optional(v.union(v.string(), v.null())),
  bodyFontName: v.optional(v.union(v.string(), v.null())),
  titleFontSize: v.optional(v.number()),
  bodyFontSize: v.optional(v.number()),
  primaryColor: v.optional(v.union(v.string(), v.null())),
  secondaryColor: v.optional(v.union(v.string(), v.null())),
  accentColor: v.optional(v.union(v.string(), v.null())),
});

/**
 * Analyze PPTX response validator
 */
export const analyzePptxResponseValidator = v.object({
  success: v.boolean(),
  slideCount: v.number(),
  slides: v.array(slideInfoValidator),
  availableLayouts: v.array(v.string()),
  branding: brandingInfoValidator,
});

/**
 * Table data validator (for PPTX generation)
 */
export const tableDataValidator = v.object({
  headers: v.array(v.string()),
  rows: v.array(v.array(v.string())),
});

/**
 * Slide content data validator (for PPTX generation)
 */
export const slideContentDataValidator = v.object({
  title: v.optional(v.string()),
  subtitle: v.optional(v.string()),
  textContent: v.optional(v.array(v.string())),
  bulletPoints: v.optional(v.array(v.string())),
  tables: v.optional(v.array(tableDataValidator)),
});

/**
 * PPTX branding data validator (for PPTX generation)
 */
export const pptxBrandingDataValidator = v.object({
  slideWidth: v.optional(v.number()),
  slideHeight: v.optional(v.number()),
  titleFontName: v.optional(v.string()),
  bodyFontName: v.optional(v.string()),
  titleFontSize: v.optional(v.number()),
  bodyFontSize: v.optional(v.number()),
  primaryColor: v.optional(v.string()),
  secondaryColor: v.optional(v.string()),
  accentColor: v.optional(v.string()),
});

/**
 * Generate PPTX response validator
 */
export const generatePptxResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.id('_storage'),
  url: v.string(),
  fileName: v.string(),
  contentType: v.string(),
  size: v.number(),
});

/**
 * DOCX section type validator
 */
export const docxSectionTypeValidator = v.union(
  v.literal('heading'),
  v.literal('paragraph'),
  v.literal('bullets'),
  v.literal('numbered'),
  v.literal('table'),
  v.literal('quote'),
  v.literal('code'),
);

/**
 * DOCX section validator
 */
export const docxSectionValidator = v.object({
  type: docxSectionTypeValidator,
  text: v.optional(v.string()),
  level: v.optional(v.number()),
  items: v.optional(v.array(v.string())),
  headers: v.optional(v.array(v.string())),
  rows: v.optional(v.array(v.array(v.string()))),
});

/**
 * DOCX content validator (for DOCX generation)
 */
export const docxContentValidator = v.object({
  title: v.optional(v.string()),
  subtitle: v.optional(v.string()),
  sections: v.array(docxSectionValidator),
});

/**
 * Generate DOCX response validator
 */
export const generateDocxResponseValidator = v.object({
  success: v.boolean(),
  fileId: v.id('_storage'),
  url: v.string(),
  fileName: v.string(),
  contentType: v.string(),
  size: v.number(),
});

/**
 * Retry RAG indexing response validator
 */
export const retryRagIndexingResponseValidator = v.object({
  success: v.boolean(),
  jobId: v.optional(v.string()),
  error: v.optional(v.string()),
});

