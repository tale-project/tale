/**
 * Type definitions for document model
 */

import type { Infer } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import {
  documentItemValidator,
  documentListResponseValidator,
  documentRecordValidator,
  ragInfoValidator,
  ragStatusValidator,
  sourceProviderValidator,
  sourceModeValidator,
} from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type RagStatus = Infer<typeof ragStatusValidator>;
export type RagInfo = Infer<typeof ragInfoValidator>;
export type SourceProvider = Infer<typeof sourceProviderValidator>;
export type SourceMode = Infer<typeof sourceModeValidator>;
export type DocumentItemResponse = Infer<typeof documentItemValidator>;
export type DocumentListResponse = Infer<typeof documentListResponseValidator>;
export type DocumentRecord = Infer<typeof documentRecordValidator>;

/**
 * Document metadata structure stored in the metadata field.
 * This provides type-safe access to common metadata properties.
 */
export interface DocumentMetadata {
  name?: string;
  type?: 'file' | 'folder';
  size?: number;
  mimeType?: string;
  extension?: string;
  storagePath?: string;
  sourceProvider?: SourceProvider;
  sourceMode?: SourceMode;
  lastModified?: number;
  syncConfigId?: string;
  isDirectlySelected?: boolean;
  oneDriveId?: string;
  oneDriveItemId?: string;
  /** Timestamp when the source file was last modified (for sync tracking) */
  sourceModifiedAt?: number;
  /** Item path in OneDrive for folder syncs */
  itemPath?: string;
  /** Timestamp when the file was last synced */
  syncedAt?: number;
}

// =============================================================================
// MANUAL TYPES (no corresponding validator)
// =============================================================================

export interface CreateDocumentArgs {
  organizationId: string;
  title?: string;

  content?: string;
  fileId?: Id<'_storage'>;
  mimeType?: string;
  extension?: string;
  metadata?: unknown;
  sourceProvider?: SourceProvider;
  externalItemId?: string;
  teamTags?: string[];
  createdBy?: string;
}

export interface CreateDocumentResult {
  success: boolean;
  documentId: Id<'documents'>;
}

export interface QueryDocumentsArgs {
  organizationId: string;
  sourceProvider?: SourceProvider;
  paginationOpts: {
    numItems: number;
    cursor: string | null;
  };
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
