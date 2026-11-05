import { formatFileSize } from '@tale/ui/format';
import type { TFunction } from 'i18next';

import { READ_REFUSED_RAG_ERROR_CODES } from '@/backend/core/knowledge/rag_error_codes';
import { shouldRagIndexOnUpload } from '@/lib/shared/file-types';

import type { FileIndexingInfo } from '../hooks/use-file-indexing-status';

/**
 * Where a document attachment stands for the assistant, from its read
 * (`textStatus`) and its index (`status`) — one decision for the chip, the
 * toasts and the send gate's words, so they never disagree:
 *
 *  - `reading`: its read is still to come (or its status not known yet);
 *  - `ready`: the assistant reads it — its checked text, or its index;
 *  - `refused`: the organization's secret scan or PII policy refuses it;
 *  - `unreadable`: it holds no text a reader finds, or does not open;
 *  - `indexing`: too large to read before its index, which is being built;
 *  - `indexFailed`: only its index could serve it, and the index failed;
 *  - `unsupported`: no extractor reads its type.
 */
export type DocumentReadingState =
  | { readonly kind: 'reading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'unreadable'; readonly code: string | undefined }
  | { readonly kind: 'indexing' }
  | { readonly kind: 'indexFailed' }
  | { readonly kind: 'unsupported' };

export function documentReadingState(
  info: FileIndexingInfo | undefined,
): DocumentReadingState {
  if (info === undefined) return { kind: 'reading' };
  const { textStatus, status } = info;
  if (textStatus === 'refused') {
    return { kind: 'refused', code: info.textErrorCode ?? 'pii_blocked' };
  }
  // An index the organization's checks refused speaks over a read — except
  // a PII scan that could not run there, when a read checked the text since.
  if (
    status === 'failed' &&
    info.errorCode !== undefined &&
    READ_REFUSED_RAG_ERROR_CODES.has(info.errorCode) &&
    !(info.errorCode === 'pii_scan_failed' && textStatus === 'ready')
  ) {
    return { kind: 'refused', code: info.errorCode };
  }
  if (textStatus === 'ready' || status === 'completed')
    return { kind: 'ready' };
  if (textStatus === 'unreadable') {
    return info.textErrorCode === 'unsupported_type'
      ? { kind: 'unsupported' }
      : { kind: 'unreadable', code: info.textErrorCode };
  }
  // A read still to come — unless the file's index already ended without
  // it, which a lost read leaves behind until the read watchdog settles it.
  if (
    (textStatus === 'queued' || textStatus === 'running') &&
    status !== 'failed' &&
    status !== 'unsupported'
  ) {
    return { kind: 'reading' };
  }
  // Left to its index — or a file from before reads existed.
  if (status === 'queued' || status === 'running') return { kind: 'indexing' };
  if (status === 'failed') return { kind: 'indexFailed' };
  if (status === 'unsupported') return { kind: 'unsupported' };
  return { kind: 'ready' };
}

/** The chip's words: keys of the chat catalog. */
const CHIP_KEYS = {
  reading: 'documentReading',
  refused: 'documentRefused',
  noText: 'documentNoText',
  malformed: 'documentMalformed',
  indexing: 'indexing',
  queued: 'indexingQueued',
  readingText: 'indexingReadingText',
  progress: 'indexingProgress',
  failed: 'indexingFailed',
  unsupported: 'indexingUnsupported',
} as const;

/** The sentences that explain a state — the toast's words and the chip's
 * hover: keys of the chat catalog. */
const DETAIL_KEYS = {
  refusedSecret: 'documentRefusedSecret',
  refusedPii: 'documentRefusedPii',
  refusedUnscanned: 'documentRefusedPiiUnscanned',
  noText: 'documentNoTextDescription',
  malformed: 'documentMalformedDescription',
  indexFailed: 'indexingFailedDescription',
  unsupported: 'indexingUnsupportedDescription',
} as const;

export interface DocumentChipStatus {
  /** The chip's second line. */
  readonly label: string;
  /** The file cannot be read: drawn as a failure. */
  readonly failed: boolean;
  /** The send waits for this file: drawn with a spinner. */
  readonly busy: boolean;
  /** Why the assistant cannot read the file, in a sentence, when it
   * cannot. */
  readonly detail?: string;
}

/** Why the assistant cannot read a document in this state, in a sentence —
 * undefined for a state that needs none. */
function documentStateDetail(
  t: TFunction,
  state: DocumentReadingState,
  filename: string,
): string | undefined {
  switch (state.kind) {
    case 'refused':
      return t(
        state.code === 'secret_detected'
          ? DETAIL_KEYS.refusedSecret
          : state.code === 'pii_scan_failed'
            ? DETAIL_KEYS.refusedUnscanned
            : DETAIL_KEYS.refusedPii,
        { filename },
      );
    case 'unreadable':
      return t(
        state.code === 'malformed' ? DETAIL_KEYS.malformed : DETAIL_KEYS.noText,
        { filename },
      );
    case 'indexFailed':
      return t(DETAIL_KEYS.indexFailed, { filename });
    case 'unsupported':
      return t(DETAIL_KEYS.unsupported, { filename });
    default:
      return undefined;
  }
}

/**
 * What a document's chip says — staged in the composer, or parked with a
 * send that waits. A document is read right after its upload, in seconds;
 * once read, its chip shows its size, whatever its search index is doing.
 * Only a document too large to read before its index shows the index at
 * work, in the reader's language, never the server's own progress words. A
 * file the organization's checks refuse, or one with no readable text, says
 * so.
 */
export function documentChipStatus(
  t: TFunction,
  attachment: {
    readonly fileName: string;
    readonly fileType: string;
    readonly fileSize: number;
  },
  info: FileIndexingInfo | undefined,
): DocumentChipStatus {
  // A file no upload reads or indexes is attached as it is.
  const state = shouldRagIndexOnUpload(attachment.fileName, attachment.fileType)
    ? documentReadingState(info)
    : ({ kind: 'ready' } as const);
  const detail = documentStateDetail(t, state, attachment.fileName);
  return {
    ...chipLine(t, state, attachment.fileSize, info),
    ...(detail !== undefined ? { detail } : {}),
  };
}

function chipLine(
  t: TFunction,
  state: DocumentReadingState,
  fileSize: number,
  info: FileIndexingInfo | undefined,
): Omit<DocumentChipStatus, 'detail'> {
  switch (state.kind) {
    case 'reading':
      return { label: t(CHIP_KEYS.reading), failed: false, busy: true };
    case 'ready':
      return { label: formatFileSize(fileSize), failed: false, busy: false };
    case 'refused':
      return { label: t(CHIP_KEYS.refused), failed: true, busy: false };
    case 'unreadable':
      return {
        label: t(
          state.code === 'malformed' ? CHIP_KEYS.malformed : CHIP_KEYS.noText,
        ),
        failed: false,
        busy: false,
      };
    case 'indexing':
      return { label: indexingLabel(t, info), failed: false, busy: true };
    case 'indexFailed':
      return { label: t(CHIP_KEYS.failed), failed: true, busy: false };
    default:
      // `unsupported`: no extractor reads its type.
      return { label: t(CHIP_KEYS.unsupported), failed: false, busy: false };
  }
}

/** The index at work, as far as its progress says. */
function indexingLabel(t: TFunction, info: FileIndexingInfo | undefined) {
  const progress = info?.progress ?? '';
  const counted = /(\d+)\/(\d+)/.exec(progress);
  if (counted !== null && Number(counted[2]) > 0) {
    return t(CHIP_KEYS.progress, {
      percent: Math.round((Number(counted[1]) / Number(counted[2])) * 100),
    });
  }
  if (progress.startsWith('Extracting')) return t(CHIP_KEYS.readingText);
  return info?.status === 'queued'
    ? t(CHIP_KEYS.queued)
    : t(CHIP_KEYS.indexing);
}
