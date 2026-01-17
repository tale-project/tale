/**
 * Convex validators for document operations
 * Generated from shared Zod schemas using zodToConvex
 */

import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  sourceProviderSchema,
  sourceModeSchema,
  ragStatusSchema,
  ragInfoStatusSchema,
  ragInfoSchema,
  documentItemSchema,
  documentListResponseSchema,
  documentRecordSchema,
  generateDocumentResponseSchema,
  generatePptxResponseSchema,
  generateDocxResponseSchema,
  uploadFileResponseSchema,
} from '../../lib/shared/schemas/documents';

export {
  sourceProviderSchema,
  sourceModeSchema,
  ragStatusSchema,
  ragInfoSchema,
  documentItemSchema,
  documentRecordSchema,
} from '../../lib/shared/schemas/documents';

export const sourceProviderValidator = zodToConvex(sourceProviderSchema);
export const sourceModeValidator = zodToConvex(sourceModeSchema);
export const ragStatusValidator = zodToConvex(ragStatusSchema);
export const ragInfoStatusValidator = zodToConvex(ragInfoStatusSchema);
export const ragInfoValidator = zodToConvex(ragInfoSchema);
export const documentItemValidator = zodToConvex(documentItemSchema);
export const documentListResponseValidator = zodToConvex(documentListResponseSchema);
export const documentRecordValidator = zodToConvex(documentRecordSchema);
export const generateDocumentResponseValidator = zodToConvex(generateDocumentResponseSchema);
export const generatePptxResponseValidator = zodToConvex(generatePptxResponseSchema);
export const generateDocxResponseValidator = zodToConvex(generateDocxResponseSchema);
export const uploadFileResponseValidator = zodToConvex(uploadFileResponseSchema);
