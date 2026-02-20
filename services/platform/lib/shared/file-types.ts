/**
 * Unified file domain model.
 *
 * Single source of truth for MIME types, extensions, file classification,
 * accept strings, and size limits across the entire platform.
 */

import { isTextBasedFile, TEXT_FILE_ACCEPT } from '../utils/text-file-types';

// ---------------------------------------------------------------------------
// MIME type constants
// ---------------------------------------------------------------------------

const MIME_TYPES = {
  // Images
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  GIF: 'image/gif',
  WEBP: 'image/webp',

  // Documents
  PDF: 'application/pdf',
  DOC: 'application/msword',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

  // Presentations
  PPT: 'application/vnd.ms-powerpoint',
  PPTX: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

  // Spreadsheets
  XLS: 'application/vnd.ms-excel',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv',

  // Text
  PLAIN: 'text/plain',
} as const;

type MimeType = (typeof MIME_TYPES)[keyof typeof MIME_TYPES];

// ---------------------------------------------------------------------------
// Grouped MIME sets (for validation)
// ---------------------------------------------------------------------------

const IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  MIME_TYPES.JPEG,
  MIME_TYPES.PNG,
  MIME_TYPES.GIF,
  MIME_TYPES.WEBP,
]);

const DOCUMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  MIME_TYPES.PDF,
  MIME_TYPES.DOC,
  MIME_TYPES.DOCX,
]);

const PRESENTATION_MIME_TYPES: ReadonlySet<string> = new Set([
  MIME_TYPES.PPT,
  MIME_TYPES.PPTX,
]);

const SPREADSHEET_MIME_TYPES: ReadonlySet<string> = new Set([
  MIME_TYPES.XLS,
  MIME_TYPES.XLSX,
  MIME_TYPES.CSV,
]);

const TEXT_MIME_TYPES: ReadonlySet<string> = new Set([MIME_TYPES.PLAIN]);

// ---------------------------------------------------------------------------
// File classification
// ---------------------------------------------------------------------------

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function isTextFile(mimeType: string, fileName?: string): boolean {
  if (!fileName) return mimeType.startsWith('text/plain');
  return isTextBasedFile(fileName, mimeType);
}

export function isSpreadsheet(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')
  );
}

function isParseable(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.pptx')
  );
}

// ---------------------------------------------------------------------------
// Extension helpers
// ---------------------------------------------------------------------------

/**
 * Extract file extension from a filename (lowercase, no dot).
 * Returns undefined when no extension is found.
 */
export function extractExtension(filename?: string): string | undefined {
  if (!filename) return undefined;

  const lastDotIndex = filename.lastIndexOf('.');
  if (lastDotIndex === -1) return undefined;

  // Hidden files like ".gitignore"
  if (lastDotIndex === 0) {
    const ext = filename.slice(1).toLowerCase();
    return ext.length > 0 ? ext : undefined;
  }

  const extension = filename.slice(lastDotIndex + 1).toLowerCase();
  return extension.length > 0 ? extension : undefined;
}

/**
 * Extract file extension for display (uppercase).
 * Handles URLs by stripping query/hash. Returns 'FILE' as fallback.
 */
export function getDisplayExtension(filename: string): string {
  try {
    const url = new URL(filename, 'http://local');
    const lastSegment = url.pathname.split('/').pop() || '';
    const ext = lastSegment.includes('.')
      ? lastSegment.split('.').pop()
      : undefined;
    return ext ? ext.toUpperCase() : 'FILE';
  } catch {
    const clean = filename.split('?')[0].split('#')[0];
    const lastSegment = clean.split('/').pop() || '';
    const ext = lastSegment.includes('.')
      ? lastSegment.split('.').pop()
      : undefined;
    return ext ? ext.toUpperCase() : 'FILE';
  }
}

// ---------------------------------------------------------------------------
// Accept strings (for <input accept="..."> and drop zones)
// ---------------------------------------------------------------------------

/** Chat attachment input: images + documents + text-based files */
export const CHAT_UPLOAD_ACCEPT = TEXT_FILE_ACCEPT;

/** Chat upload MIME validation list */
export const CHAT_UPLOAD_ALLOWED_TYPES: readonly string[] = [
  MIME_TYPES.JPEG,
  MIME_TYPES.PNG,
  MIME_TYPES.GIF,
  MIME_TYPES.WEBP,
  MIME_TYPES.PDF,
  MIME_TYPES.PLAIN,
  MIME_TYPES.DOC,
  MIME_TYPES.DOCX,
  MIME_TYPES.PPT,
  MIME_TYPES.PPTX,
];

/** Document upload dialog: all supported document types + images */
export const DOCUMENT_UPLOAD_ACCEPT = [
  MIME_TYPES.PDF,
  MIME_TYPES.DOC,
  MIME_TYPES.DOCX,
  MIME_TYPES.PPT,
  MIME_TYPES.PPTX,
  MIME_TYPES.XLS,
  MIME_TYPES.XLSX,
  MIME_TYPES.CSV,
  MIME_TYPES.PLAIN,
  'image/*',
  '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt',
].join(',');

/** Data import forms: spreadsheets only */
export const SPREADSHEET_IMPORT_ACCEPT = '.xlsx,.xls,.csv';

// ---------------------------------------------------------------------------
// Size limits
// ---------------------------------------------------------------------------

/** Chat attachment max (10 MB) */
export const CHAT_MAX_FILE_SIZE = 10 * 1024 * 1024;

/** Document upload max (100 MB) */
export const DOCUMENT_MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Max file IDs per batch URL query */
export const MAX_BATCH_FILE_IDS = 10;

// ---------------------------------------------------------------------------
// Parse endpoint routing
// ---------------------------------------------------------------------------

const PARSE_ENDPOINTS: Record<string, string> = {
  pdf: '/api/v1/pdf/parse',
  docx: '/api/v1/docx/parse',
  pptx: '/api/v1/pptx/parse',
};

/**
 * Get the crawler service parse endpoint for a given filename.
 * Falls back to PDF parser for unknown extensions.
 */
export function getParseEndpoint(filename: string): string {
  const ext = extractExtension(filename);
  return (ext && PARSE_ENDPOINTS[ext]) || PARSE_ENDPOINTS.pdf;
}

// ---------------------------------------------------------------------------
// MIME → display label key (for i18n)
// ---------------------------------------------------------------------------

/**
 * Returns an i18n key suffix for the file type display label.
 * Intended for use with `t('fileTypes.<key>')`.
 */
export function getFileTypeLabelKey(mimeType: string): string {
  if (mimeType === MIME_TYPES.PDF) return 'pdf';
  if (mimeType.includes('word')) return 'doc';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint'))
    return 'pptx';
  if (mimeType === MIME_TYPES.PLAIN) return 'txt';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === MIME_TYPES.XLS || mimeType === MIME_TYPES.XLSX)
    return 'xlsx';
  if (mimeType === MIME_TYPES.CSV) return 'csv';
  return 'file';
}
