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

  // Audio
  MP3: 'audio/mpeg',
  WAV: 'audio/wav',
  M4A: 'audio/mp4',
  WEBM_AUDIO: 'audio/webm',
  OGG: 'audio/ogg',

  // Video (only the audio track is transcribed; ffmpeg -vn strips video).
  // Covers the common meeting-recording formats across platforms.
  VIDEO_MP4: 'video/mp4',
  VIDEO_WEBM: 'video/webm',
  VIDEO_QUICKTIME: 'video/quicktime',
  VIDEO_MATROSKA: 'video/x-matroska',
  VIDEO_AVI: 'video/x-msvideo',
  VIDEO_M4V: 'video/x-m4v',
  VIDEO_MPEG: 'video/mpeg',
  VIDEO_OGG: 'video/ogg',
  VIDEO_3GP: 'video/3gpp',
  VIDEO_MP2T: 'video/mp2t',
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

const AUDIO_MIME_TYPES: ReadonlySet<string> = new Set([
  MIME_TYPES.MP3,
  MIME_TYPES.WAV,
  MIME_TYPES.M4A,
  MIME_TYPES.WEBM_AUDIO,
  MIME_TYPES.OGG,
]);

const VIDEO_MIME_TYPES: ReadonlySet<string> = new Set([
  MIME_TYPES.VIDEO_MP4,
  MIME_TYPES.VIDEO_WEBM,
  MIME_TYPES.VIDEO_QUICKTIME,
  MIME_TYPES.VIDEO_MATROSKA,
  MIME_TYPES.VIDEO_AVI,
  MIME_TYPES.VIDEO_M4V,
  MIME_TYPES.VIDEO_MPEG,
  MIME_TYPES.VIDEO_OGG,
  MIME_TYPES.VIDEO_3GP,
  MIME_TYPES.VIDEO_MP2T,
]);

// ---------------------------------------------------------------------------
// File classification
// ---------------------------------------------------------------------------

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function isAudio(mimeType: string): boolean {
  return mimeType.startsWith('audio/');
}

function isVideo(mimeType: string): boolean {
  return mimeType.startsWith('video/');
}

/**
 * Audio or video — files that flow through the transcription pipeline
 * (ffmpeg extracts the audio track for video inputs, then transcribes).
 */
export function isAudioOrVideo(mimeType: string): boolean {
  return isAudio(mimeType) || isVideo(mimeType);
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
// Byte-based media detection (authoritative for audio/video classification)
// ---------------------------------------------------------------------------

function startsWith(head: Uint8Array, sig: readonly number[]): boolean {
  if (head.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (head[i] !== sig[i]) return false;
  }
  return true;
}

function equalsAt(
  head: Uint8Array,
  offset: number,
  sig: readonly number[],
): boolean {
  if (head.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (head[offset + i] !== sig[i]) return false;
  }
  return true;
}

// MP4 family: bytes 4-7 are 'ftyp', bytes 8-11 are the major brand.
function mp4MimeFromBrand(head: Uint8Array, brandOffset: number): string {
  if (head.length < brandOffset + 4) return MIME_TYPES.VIDEO_MP4;
  const brand = String.fromCharCode(
    head[brandOffset],
    head[brandOffset + 1],
    head[brandOffset + 2],
    head[brandOffset + 3],
  );
  if (brand === 'M4A ' || brand === 'M4B ') return MIME_TYPES.M4A;
  if (brand === 'qt  ') return MIME_TYPES.VIDEO_QUICKTIME;
  if (brand.startsWith('3gp') || brand.startsWith('3g2')) {
    return MIME_TYPES.VIDEO_3GP;
  }
  return MIME_TYPES.VIDEO_MP4;
}

/**
 * Classify a blob as audio/video from its content bytes, not its filename or
 * browser-reported MIME. Returns the canonical MIME on match, `null` when
 * the bytes don't match any known media container.
 *
 * Motivation: browsers report `.ts` as `video/mp2t` (MPEG Transport Stream)
 * regardless of content, which routed TypeScript source files into the
 * ffmpeg transcription pipeline. Bytes are the only reliable signal.
 */
export async function detectMediaMime(blob: Blob): Promise<string | null> {
  const sampleSize = Math.min(blob.size, 512);
  if (sampleSize < 4) return null;
  const head = new Uint8Array(await blob.slice(0, sampleSize).arrayBuffer());

  // MPEG TS: 188-byte packets, each starting with 0x47 sync byte.
  if (sampleSize >= 189 && head[0] === 0x47 && head[188] === 0x47) {
    return MIME_TYPES.VIDEO_MP2T;
  }

  // MP3: "ID3" tag or MPEG frame sync (0xFF 0xEx/Fx).
  if (startsWith(head, [0x49, 0x44, 0x33])) return MIME_TYPES.MP3;
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return MIME_TYPES.MP3;

  // RIFF container: distinguish WAV and AVI by form type at offset 8.
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46])) {
    if (equalsAt(head, 8, [0x57, 0x41, 0x56, 0x45])) return MIME_TYPES.WAV;
    if (equalsAt(head, 8, [0x41, 0x56, 0x49, 0x20])) {
      return MIME_TYPES.VIDEO_AVI;
    }
  }

  // Ogg: "OggS". Audio vs. video Ogg aren't distinguishable from the first
  // bytes; default to audio (pipeline treats both identically).
  if (startsWith(head, [0x4f, 0x67, 0x67, 0x53])) return MIME_TYPES.OGG;

  // EBML (Matroska / WebM). DocType parsing is deferred; default to WebM.
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) {
    return MIME_TYPES.VIDEO_WEBM;
  }

  // MP4 family: 'ftyp' at offset 4, brand at offset 8.
  if (equalsAt(head, 4, [0x66, 0x74, 0x79, 0x70])) {
    return mp4MimeFromBrand(head, 8);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Extension → MIME resolution (handles unreliable browser MIME detection)
// ---------------------------------------------------------------------------

// Audio/video extensions are intentionally absent: media classification is
// byte-driven (see `detectMediaMime`). Extensions are unreliable for media —
// notably `.ts` maps to both TypeScript source and MPEG Transport Stream.
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
  [MIME_TYPES.MP3]: 'mp3',
  [MIME_TYPES.WAV]: 'wav',
  [MIME_TYPES.M4A]: 'm4a',
  [MIME_TYPES.WEBM_AUDIO]: 'webm',
  [MIME_TYPES.OGG]: 'ogg',
  [MIME_TYPES.VIDEO_MP4]: 'mp4',
  [MIME_TYPES.VIDEO_M4V]: 'm4v',
  [MIME_TYPES.VIDEO_QUICKTIME]: 'mov',
  [MIME_TYPES.VIDEO_WEBM]: 'webm',
  [MIME_TYPES.VIDEO_MATROSKA]: 'mkv',
  [MIME_TYPES.VIDEO_AVI]: 'avi',
  [MIME_TYPES.VIDEO_MPEG]: 'mpeg',
  [MIME_TYPES.VIDEO_OGG]: 'ogv',
  [MIME_TYPES.VIDEO_3GP]: '3gp',
  [MIME_TYPES.VIDEO_MP2T]: 'ts',
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
  // Audio/video classification is byte-driven (see `detectMediaMime`). This
  // function never returns audio/* or video/* — browser MIME and extension
  // are both unreliable for media (browsers report .ts as video/mp2t).
  const mime = isAudioOrVideo(browserMime) ? '' : browserMime;
  if (mime && KNOWN_MIME_TYPES.has(mime)) return mime;
  const ext = extractExtension(fileName);
  if (ext) {
    const resolved = EXTENSION_TO_MIME[ext];
    if (resolved) return resolved;
  }
  return mime;
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

/** Chat attachment input: images + documents + text-based files + audio + video.
 * `audio/*` and `video/*` cover most browsers but some file pickers filter
 * strictly by extension, so we append the explicit list too. */
export const CHAT_UPLOAD_ACCEPT = [
  TEXT_FILE_ACCEPT,
  'audio/*',
  'video/*',
  // Audio
  '.mp3',
  '.m4a',
  '.wav',
  '.ogg',
  '.oga',
  '.mpga',
  // Video / mixed containers (.mp4/.webm may be audio or video — browser
  // MIME wins when present; otherwise we assume video since that's what
  // meeting recordings are)
  '.mp4',
  '.m4v',
  '.mov',
  '.qt',
  '.webm',
  '.mkv',
  '.avi',
  '.mpeg',
  '.mpg',
  '.ogv',
  '.3gp',
  '.3g2',
  '.ts',
  '.m2ts',
].join(',');

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
  MIME_TYPES.XLS,
  MIME_TYPES.XLSX,
  MIME_TYPES.CSV,
  MIME_TYPES.MP3,
  MIME_TYPES.WAV,
  MIME_TYPES.M4A,
  MIME_TYPES.WEBM_AUDIO,
  MIME_TYPES.OGG,
  MIME_TYPES.VIDEO_MP4,
  MIME_TYPES.VIDEO_WEBM,
  MIME_TYPES.VIDEO_QUICKTIME,
  MIME_TYPES.VIDEO_MATROSKA,
  MIME_TYPES.VIDEO_AVI,
  MIME_TYPES.VIDEO_M4V,
  MIME_TYPES.VIDEO_MPEG,
  MIME_TYPES.VIDEO_OGG,
  MIME_TYPES.VIDEO_3GP,
  MIME_TYPES.VIDEO_MP2T,
];

/** Allowed MIME types for document uploads (used for client + server validation) */
const DOCUMENT_UPLOAD_ALLOWED_TYPES: ReadonlySet<string> = new Set([
  MIME_TYPES.PDF,
  MIME_TYPES.DOC,
  MIME_TYPES.DOCX,
  MIME_TYPES.PPT,
  MIME_TYPES.PPTX,
  MIME_TYPES.XLS,
  MIME_TYPES.XLSX,
  MIME_TYPES.CSV,
  MIME_TYPES.PLAIN,
  MIME_TYPES.JPEG,
  MIME_TYPES.PNG,
  MIME_TYPES.GIF,
  MIME_TYPES.WEBP,
]);

/** Allowed extensions for document uploads (fallback when MIME is unreliable) */
const DOCUMENT_UPLOAD_ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'csv',
  'txt',
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
]);

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
  MIME_TYPES.JPEG,
  MIME_TYPES.PNG,
  MIME_TYPES.GIF,
  MIME_TYPES.WEBP,
  '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.gif,.webp',
].join(',');

/** Data import forms: spreadsheets only */
export const SPREADSHEET_IMPORT_ACCEPT = '.xlsx,.xls,.csv';

// ---------------------------------------------------------------------------
// Size limits
// ---------------------------------------------------------------------------

/** Chat attachment max (100 MB) */
export const CHAT_MAX_FILE_SIZE = 100 * 1024 * 1024;

/**
 * Chat audio/video attachment max size (2 GB). Large media files go through
 * server-side ffmpeg (video is stripped via -vn, audio silence-removed and
 * re-encoded to 32 kbps Opus) before transcription, so the raw upload can
 * be far larger than OpenAI's 25 MB cap. Duration is the real gate —
 * see `CHAT_AUDIO_MAX_DURATION_SEC`.
 */
const CHAT_AUDIO_MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024;

/**
 * Chat audio/video attachment max duration (4 hours). Covers board meetings,
 * workshops, and all-day sessions. Enforced client-side via the file's
 * metadata `duration` before upload. Anything longer is rejected with a
 * clear error rather than silently truncated.
 */
export const CHAT_AUDIO_MAX_DURATION_SEC = 4 * 60 * 60;

/**
 * Resolve the per-type size ceiling for a chat upload. Audio and video share
 * the 2 GB cap (both go through the transcription pipeline); everything
 * else uses the generic 100 MB cap.
 */
export function getMaxFileSizeForType(mimeType: string): number {
  if (isAudioOrVideo(mimeType)) return CHAT_AUDIO_MAX_FILE_SIZE;
  return CHAT_MAX_FILE_SIZE;
}

/** Max attachments per chat message */
export const CHAT_MAX_FILE_COUNT = 10;

/** Max total attachment size per chat message (200 MB) */
export const CHAT_MAX_TOTAL_SIZE = 200 * 1024 * 1024;

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
  text: {
    accept: [
      '.txt',
      '.md',
      '.html',
      '.css',
      '.json',
      '.yaml',
      '.yml',
      '.toml',
      '.xml',
      '.sql',
      '.graphql',
      '.log',
      '.js',
      '.ts',
      '.jsx',
      '.tsx',
      '.py',
      '.rb',
      '.sh',
      '.env',
      MIME_TYPES.PLAIN,
      'text/markdown',
      'text/html',
      'text/css',
      'application/json',
      'application/xml',
      'application/javascript',
      'application/typescript',
      'application/x-yaml',
      'application/sql',
      'application/graphql',
    ],
    mimeTypes: [
      MIME_TYPES.PLAIN,
      'text/markdown',
      'text/html',
      'text/css',
      'application/json',
      'application/xml',
      'application/javascript',
      'application/typescript',
      'application/x-yaml',
      'application/sql',
      'application/graphql',
    ],
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

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// MIME → display label key (for i18n)
// ---------------------------------------------------------------------------

/**
 * Returns an i18n key suffix for the file type display label.
 * Intended for use with `t('fileTypes.<key>')`.
 */
function getFileTypeLabelKey(mimeType: string): string {
  if (mimeType === MIME_TYPES.PDF) return 'pdf';
  if (mimeType.includes('word')) return 'doc';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint'))
    return 'pptx';
  if (mimeType === MIME_TYPES.PLAIN) return 'txt';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType === MIME_TYPES.XLS || mimeType === MIME_TYPES.XLSX)
    return 'xlsx';
  if (mimeType === MIME_TYPES.CSV) return 'csv';
  return 'file';
}

/**
 * Check whether a file is allowed for document upload based on its resolved
 * MIME type and extension. Returns `true` when either the MIME type or the
 * file extension matches the allowlist.
 */
export function isAllowedDocumentUpload(
  resolvedMimeType: string,
  fileName: string,
): boolean {
  if (DOCUMENT_UPLOAD_ALLOWED_TYPES.has(resolvedMimeType)) return true;
  const ext = extractExtension(fileName);
  return ext ? DOCUMENT_UPLOAD_ALLOWED_EXTENSIONS.has(ext) : false;
}

/**
 * Map a MIME type to its canonical file extension (without dot).
 * Returns `undefined` for unknown or generic types like `application/octet-stream`.
 */
export function mimeToExtension(mime: string): string | undefined {
  const base = mime.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXTENSION[base];
}
