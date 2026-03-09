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

// ---------------------------------------------------------------------------
// Extension → MIME resolution (handles unreliable browser MIME detection)
// ---------------------------------------------------------------------------

const EXTENSION_TO_MIME: Readonly<Record<string, MimeType>> = {
  jpg: MIME_TYPES.JPEG,
  jpeg: MIME_TYPES.JPEG,
  png: MIME_TYPES.PNG,
  gif: MIME_TYPES.GIF,
  webp: MIME_TYPES.WEBP,
  pdf: MIME_TYPES.PDF,
  doc: MIME_TYPES.DOC,
  docx: MIME_TYPES.DOCX,
  ppt: MIME_TYPES.PPT,
  pptx: MIME_TYPES.PPTX,
  xls: MIME_TYPES.XLS,
  xlsx: MIME_TYPES.XLSX,
  csv: MIME_TYPES.CSV,
  txt: MIME_TYPES.PLAIN,
};

const MIME_TO_EXTENSION: Readonly<Record<string, string>> = {
  [MIME_TYPES.JPEG]: 'jpg',
  [MIME_TYPES.PNG]: 'png',
  [MIME_TYPES.GIF]: 'gif',
  [MIME_TYPES.WEBP]: 'webp',
  [MIME_TYPES.PDF]: 'pdf',
  [MIME_TYPES.DOC]: 'doc',
  [MIME_TYPES.DOCX]: 'docx',
  [MIME_TYPES.PPT]: 'ppt',
  [MIME_TYPES.PPTX]: 'pptx',
  [MIME_TYPES.XLS]: 'xls',
  [MIME_TYPES.XLSX]: 'xlsx',
  [MIME_TYPES.CSV]: 'csv',
  [MIME_TYPES.PLAIN]: 'txt',
};

const KNOWN_MIME_TYPES: ReadonlySet<string> = new Set(
  Object.values(MIME_TYPES),
);

/**
 * Resolve the correct MIME type for a file, falling back to extension-based
 * lookup when the browser reports a generic or empty MIME type.
 *
 * Browsers may report `.docx` as `application/zip`, `application/octet-stream`,
 * or empty string instead of the correct Office XML MIME type.
 */
export function resolveFileType(fileName: string, browserMime: string): string {
  if (browserMime && KNOWN_MIME_TYPES.has(browserMime)) {
    return browserMime;
  }
  const ext = extractExtension(fileName);
  if (ext) {
    const resolved = EXTENSION_TO_MIME[ext];
    if (resolved) return resolved;
  }
  return browserMime;
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
// Tool name → file type mapping (for agent-scoped file uploads)
// ---------------------------------------------------------------------------

/** Maps document tool names to their accepted file extensions and MIME types. */
const TOOL_FILE_MAP: Record<
  string,
  { accept: string[]; mimeTypes: readonly string[] }
> = {
  image: {
    accept: ['image/*'],
    mimeTypes: [
      MIME_TYPES.JPEG,
      MIME_TYPES.PNG,
      MIME_TYPES.GIF,
      MIME_TYPES.WEBP,
    ],
  },
  pdf: {
    accept: ['.pdf', MIME_TYPES.PDF],
    mimeTypes: [MIME_TYPES.PDF],
  },
  docx: {
    accept: ['.doc', '.docx', MIME_TYPES.DOC, MIME_TYPES.DOCX],
    mimeTypes: [MIME_TYPES.DOC, MIME_TYPES.DOCX],
  },
  pptx: {
    accept: ['.ppt', '.pptx', MIME_TYPES.PPT, MIME_TYPES.PPTX],
    mimeTypes: [MIME_TYPES.PPT, MIME_TYPES.PPTX],
  },
  txt: {
    accept: ['.txt', MIME_TYPES.PLAIN],
    mimeTypes: [MIME_TYPES.PLAIN],
  },
  excel: {
    accept: [
      '.xls',
      '.xlsx',
      '.csv',
      MIME_TYPES.XLS,
      MIME_TYPES.XLSX,
      MIME_TYPES.CSV,
    ],
    mimeTypes: [MIME_TYPES.XLS, MIME_TYPES.XLSX, MIME_TYPES.CSV],
  },
};

const DOCUMENT_TOOL_NAMES = new Set(Object.keys(TOOL_FILE_MAP));

/**
 * Returns the `<input accept="...">` string scoped to the agent's enabled
 * document tools. Returns `undefined` when no document tools are enabled
 * (file upload should be hidden).
 */
export function getAcceptForTools(
  toolNames: readonly string[],
): string | undefined {
  const parts: string[] = [];
  for (const tool of toolNames) {
    const mapping = TOOL_FILE_MAP[tool];
    if (mapping) {
      parts.push(...mapping.accept);
    }
  }
  return parts.length > 0 ? parts.join(',') : undefined;
}

/**
 * Returns the allowed MIME types for client-side validation scoped to the
 * agent's enabled document tools. Returns `undefined` when no document
 * tools are enabled.
 */
export function getAllowedMimeTypesForTools(
  toolNames: readonly string[],
): string[] | undefined {
  const mimeTypes: string[] = [];
  for (const tool of toolNames) {
    const mapping = TOOL_FILE_MAP[tool];
    if (mapping) {
      mimeTypes.push(...mapping.mimeTypes);
    }
  }
  return mimeTypes.length > 0 ? mimeTypes : undefined;
}

/**
 * Returns whether any document/file tools are enabled for the given agent.
 */
export function hasFileTools(toolNames: readonly string[]): boolean {
  return toolNames.some((t) => DOCUMENT_TOOL_NAMES.has(t));
}

/**
 * Returns the `<input accept="...">` string for all supported file types.
 * Used when the agent has bound workflows that may accept file inputs.
 */
export function getAllAcceptForTools(): string {
  const parts: string[] = [];
  for (const mapping of Object.values(TOOL_FILE_MAP)) {
    parts.push(...mapping.accept);
  }
  return parts.join(',');
}

/**
 * Returns all allowed MIME types across all supported file tools.
 * Used when the agent has bound workflows that may accept file inputs.
 */
export function getAllAllowedMimeTypes(): string[] {
  const mimeTypes: string[] = [];
  for (const mapping of Object.values(TOOL_FILE_MAP)) {
    mimeTypes.push(...mapping.mimeTypes);
  }
  return mimeTypes;
}

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

/**
 * Map a MIME type to its canonical file extension (without dot).
 * Returns `undefined` for unknown or generic types like `application/octet-stream`.
 */
export function mimeToExtension(mime: string): string | undefined {
  const base = mime.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXTENSION[base];
}
