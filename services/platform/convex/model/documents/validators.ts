import { zodToConvex } from 'convex-helpers/server/zod3';
import {
	ragStatusSchema,
	ragInfoStatusSchema,
	ragInfoSchema,
	sourceProviderSchema,
	sourceModeSchema,
	documentTypeSchema,
	sourceTypeSchema,
	outputFormatSchema,
	waitUntilSchema,
	docxSectionTypeSchema,
	documentItemSchema,
	paginationSchema,
	documentListResponseSchema,
	documentRecordSchema,
	excelSheetSchema,
	generateExcelResponseSchema,
	uploadBase64ResponseSchema,
	readFileBase64ResponseSchema,
	pdfOptionsSchema,
	imageOptionsSchema,
	urlOptionsSchema,
	generateDocumentResponseSchema,
	membershipSchema,
	signedUrlResponseSchema,
	documentByExtensionItemSchema,
	deleteFromRagResponseSchema,
	uploadFileResponseSchema,
	createOneDriveSyncConfigResponseSchema,
	tableDataSchema,
	slideContentSchema,
	pptxBrandingDataSchema,
	generatePptxResponseSchema,
	docxSectionSchema,
	docxContentSchema,
	generateDocxResponseSchema,
	retryRagIndexingResponseSchema,
	createDocumentFromUploadResponseSchema,
} from '../../../lib/shared/validators/documents';

export * from '../common/validators';
export * from '../../../lib/shared/validators/documents';

export const ragStatusValidator = zodToConvex(ragStatusSchema);
export const ragInfoStatusValidator = zodToConvex(ragInfoStatusSchema);
export const ragInfoValidator = zodToConvex(ragInfoSchema);
export const sourceProviderValidator = zodToConvex(sourceProviderSchema);
export const sourceModeValidator = zodToConvex(sourceModeSchema);
export const documentTypeValidator = zodToConvex(documentTypeSchema);
export const sourceTypeValidator = zodToConvex(sourceTypeSchema);
export const outputFormatValidator = zodToConvex(outputFormatSchema);
export const waitUntilValidator = zodToConvex(waitUntilSchema);
export const docxSectionTypeValidator = zodToConvex(docxSectionTypeSchema);
export const documentItemValidator = zodToConvex(documentItemSchema);
export const paginationValidator = zodToConvex(paginationSchema);
export const documentListResponseValidator = zodToConvex(documentListResponseSchema);
export const documentRecordValidator = zodToConvex(documentRecordSchema);
export const excelSheetValidator = zodToConvex(excelSheetSchema);
export const generateExcelResponseValidator = zodToConvex(generateExcelResponseSchema);
export const uploadBase64ResponseValidator = zodToConvex(uploadBase64ResponseSchema);
export const readFileBase64ResponseValidator = zodToConvex(readFileBase64ResponseSchema);
export const pdfOptionsValidator = zodToConvex(pdfOptionsSchema);
export const imageOptionsValidator = zodToConvex(imageOptionsSchema);
export const urlOptionsValidator = zodToConvex(urlOptionsSchema);
export const generateDocumentResponseValidator = zodToConvex(generateDocumentResponseSchema);
export const membershipValidator = zodToConvex(membershipSchema);
export const signedUrlResponseValidator = zodToConvex(signedUrlResponseSchema);
export const documentByExtensionItemValidator = zodToConvex(documentByExtensionItemSchema);
export const deleteFromRagResponseValidator = zodToConvex(deleteFromRagResponseSchema);
export const uploadFileResponseValidator = zodToConvex(uploadFileResponseSchema);
export const createOneDriveSyncConfigResponseValidator = zodToConvex(createOneDriveSyncConfigResponseSchema);
export const tableDataValidator = zodToConvex(tableDataSchema);
export const slideContentValidator = zodToConvex(slideContentSchema);
export const pptxBrandingDataValidator = zodToConvex(pptxBrandingDataSchema);
export const generatePptxResponseValidator = zodToConvex(generatePptxResponseSchema);
export const docxSectionValidator = zodToConvex(docxSectionSchema);
export const docxContentValidator = zodToConvex(docxContentSchema);
export const generateDocxResponseValidator = zodToConvex(generateDocxResponseSchema);
export const retryRagIndexingResponseValidator = zodToConvex(retryRagIndexingResponseSchema);
export const createDocumentFromUploadResponseValidator = zodToConvex(createDocumentFromUploadResponseSchema);

