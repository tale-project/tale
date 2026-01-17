/**
 * Convex validators for document operations
 *
 * Note: Some schemas use jsonRecordSchema which contains z.lazy() for recursive types.
 * zodToConvex doesn't support z.lazy(), so complex validators are defined with native Convex v.
 */

import { v } from 'convex/values';
import { zodToConvex } from 'convex-helpers/server/zod3';
import {
  sourceProviderSchema,
  sourceModeSchema,
  ragStatusSchema,
  ragInfoStatusSchema,
  ragInfoSchema,
  documentItemSchema,
  documentListResponseSchema,
  generateDocumentResponseSchema,
  generatePptxResponseSchema,
  generateDocxResponseSchema,
  uploadFileResponseSchema,
} from '../../lib/shared/schemas/documents';
import { jsonRecordValidator } from '../../lib/shared/schemas/utils/json-value';

export {
  sourceProviderSchema,
  sourceModeSchema,
  ragStatusSchema,
  ragInfoSchema,
  documentItemSchema,
  documentRecordSchema,
} from '../../lib/shared/schemas/documents';

// Simple schemas without z.lazy()
export const sourceProviderValidator = zodToConvex(sourceProviderSchema);
export const sourceModeValidator = zodToConvex(sourceModeSchema);
export const ragStatusValidator = zodToConvex(ragStatusSchema);
export const ragInfoStatusValidator = zodToConvex(ragInfoStatusSchema);
export const ragInfoValidator = zodToConvex(ragInfoSchema);
export const documentItemValidator = zodToConvex(documentItemSchema);
export const documentListResponseValidator = zodToConvex(documentListResponseSchema);
export const generateDocumentResponseValidator = zodToConvex(generateDocumentResponseSchema);
export const generatePptxResponseValidator = zodToConvex(generatePptxResponseSchema);
export const generateDocxResponseValidator = zodToConvex(generateDocxResponseSchema);
export const uploadFileResponseValidator = zodToConvex(uploadFileResponseSchema);

// Complex schemas with jsonRecordSchema (contains z.lazy) - use native Convex v
export const documentRecordValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  organizationId: v.string(),
  title: v.optional(v.string()),
  content: v.optional(v.string()),
  fileId: v.optional(v.string()),
  mimeType: v.optional(v.string()),
  extension: v.optional(v.string()),
  metadata: v.optional(jsonRecordValidator),
  sourceProvider: v.optional(sourceProviderValidator),
  externalItemId: v.optional(v.string()),
  ragInfo: v.optional(ragInfoValidator),
});
