/**
 * Type definitions for document model
 */

import { v } from 'convex/values';
import type { Id, Doc } from '../../_generated/dataModel';

export interface CreateDocumentArgs {
  organizationId: string;
  title?: string;

  content?: string;
  fileId?: Id<'_storage'>;
  mimeType?: string;
  extension?: string;
  metadata?: unknown;
  sourceProvider?: 'onedrive' | 'upload';
  externalItemId?: string;
}

export interface CreateDocumentResult {
  success: boolean;
  documentId: Id<'documents'>;
}

export interface QueryDocumentsArgs {
  organizationId: string;

  sourceProvider?: 'onedrive' | 'upload';

  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
}

export interface QueryDocumentsResult {
  items: Array<{
    _id: Id<'documents'>;
    _creationTime: number;
    organizationId: string;
    title?: string;

    content?: string;
    fileId?: Id<'_storage'>;
    mimeType?: string;
    extension?: string;
    metadata?: unknown;
    sourceProvider?: 'onedrive' | 'upload';
    externalItemId?: string;
  }>;
  isDone: boolean;
  continueCursor: string | null;
  count: number;
}

export interface DocumentItemResponse {
  id: string;
  name?: string;
  type: 'file' | 'folder';
  size?: number;
  mimeType?: string;
  extension?: string;
  storagePath?: string;
  sourceProvider?: 'onedrive' | 'upload';
  sourceMode?: 'auto' | 'manual';
  lastModified?: number;
  syncConfigId?: string;
  isDirectlySelected?: boolean;
  url?: string;
}

export interface DocumentListResponse {
  success: boolean;
  items: DocumentItemResponse[];
  totalItems: number;
  pagination?: {
    hasNextPage: boolean;
    currentPage: number;
    pageSize: number;
  };
  error?: string;
}

export interface CheckMembershipArgs {
  organizationId: string;
  userId: string;
}

export interface MembershipResult {
  _id: string; // Better Auth member ID
  organizationId: string; // Better Auth organization ID
  identityId?: string; // Better Auth user ID
  role?: string;
}

export interface ListDocumentsByExtensionArgs {
  organizationId: string;
  extension: string;
  limit?: number;
}

export type ListDocumentsByExtensionResult = Array<{
  _id: Id<'documents'>;
  _creationTime: number;
  title?: string;
  fileId?: Id<'_storage'>;
  mimeType?: string;
  extension?: string;
  metadata?: unknown;
}>;

export type DocumentSourceType = 'markdown' | 'html' | 'url';

export type DocumentOutputFormat = 'pdf' | 'image';

export interface GenerateDocumentPdfOptions {
  format?: string; // A4, Letter, Legal, etc.
  landscape?: boolean;
  marginTop?: string;
  marginBottom?: string;
  marginLeft?: string;
  marginRight?: string;
  printBackground?: boolean;
}

export interface GenerateDocumentImageOptions {
  imageType?: string; // png or jpeg
  quality?: number; // 1-100 for jpeg
  fullPage?: boolean;
  width?: number;
  height?: number; // Only for URL screenshots
  scale?: number; // Device scale factor for high-quality images (1.0-4.0, default 2.0)
}

/** Valid Playwright wait_until values */
export type WaitUntilType = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

export interface GenerateDocumentUrlOptions {
  waitUntil?: WaitUntilType;
}

export interface GenerateDocumentArgs {
  fileName: string;
  sourceType: DocumentSourceType;
  outputFormat: DocumentOutputFormat;
  content: string;
  pdfOptions?: GenerateDocumentPdfOptions;
  imageOptions?: GenerateDocumentImageOptions;
  urlOptions?: GenerateDocumentUrlOptions;
  extraCss?: string;
  wrapInTemplate?: boolean;
}

export interface GenerateDocumentResult {
  /** Whether the document was generated and uploaded successfully */
  success: boolean;
  /** Convex storage id for the generated file */
  fileId: Id<'_storage'>;
  /** Download URL for the generated file */
  url: string;
  /** Final file name including extension */
  fileName: string;
  /** MIME type of the generated file (e.g. application/pdf) */
  contentType: string;
  /** File size in bytes */
  size: number;
  /** File extension (e.g. pdf, png, jpeg) */
  extension: string;
}

// =============================================================================
// VALIDATORS (for Convex function args/returns)
// =============================================================================

/**
 * Document item validator (for public API responses)
 */
export const DocumentItem = v.object({
  id: v.string(),
  name: v.optional(v.string()),
  type: v.union(v.literal('file'), v.literal('folder')),
  size: v.optional(v.number()),
  mimeType: v.optional(v.string()),
  extension: v.optional(v.string()),
  storagePath: v.optional(v.string()),
  sourceProvider: v.optional(
    v.union(v.literal('onedrive'), v.literal('upload')),
  ),
  sourceMode: v.optional(v.union(v.literal('auto'), v.literal('manual'))),
  lastModified: v.optional(v.number()),
  syncConfigId: v.optional(v.string()),
  isDirectlySelected: v.optional(v.boolean()),
  url: v.optional(v.string()),
});

/**
 * Document list response validator
 */
export const DocumentListResponseValidator = v.object({
  success: v.boolean(),
  items: v.array(DocumentItem),
  totalItems: v.number(),
  pagination: v.optional(
    v.object({
      hasNextPage: v.boolean(),
      currentPage: v.number(),
      pageSize: v.number(),
    }),
  ),
  error: v.optional(v.string()),
});

/**
 * Document record validator (raw database document)
 */
export const DocumentRecord = v.object({
  _id: v.id('documents'),
  _creationTime: v.number(),
  organizationId: v.string(),
  title: v.optional(v.string()),

  content: v.optional(v.string()),
  fileId: v.optional(v.id('_storage')),
  mimeType: v.optional(v.string()),
  extension: v.optional(v.string()),
  metadata: v.optional(v.any()),
  sourceProvider: v.optional(
    v.union(v.literal('onedrive'), v.literal('upload')),
  ),
  externalItemId: v.optional(v.string()),
});
