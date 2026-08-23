import { formatBytes } from '@/lib/utils/format-bytes';

/**
 * Translate function scoped to the `documents` namespace (from `useT`).
 */
type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;

interface UploadErrorData {
  code?: string;
  reasonCode?: string;
  usedBytes?: number;
  limitBytes?: number;
  expectedExtension?: string;
}

/**
 * Duck-type the structured `data` off a Convex error. Avoids
 * `instanceof ConvexError` because Vite HMR / chunk splitting can produce
 * multiple copies of the class, breaking the prototype check (same rationale
 * as `isStructuredConvexError`).
 */
function readUploadErrorData(err: unknown): UploadErrorData | undefined {
  if (err == null || typeof err !== 'object' || !('data' in err)) {
    return undefined;
  }
  const data = err.data;
  if (data == null || typeof data !== 'object') return undefined;
  return data;
}

/** Whether retrying the exact same staged bytes can plausibly succeed. */
export function isUploadErrorRetryable(err: unknown): boolean {
  const data = readUploadErrorData(err);
  const reason = data?.reasonCode;
  const code = data?.code;

  if (code === 'RATE_LIMITED') return true;
  if (
    reason === 'volume_exceeded' ||
    reason === 'file_too_large' ||
    reason === 'extension_blocked' ||
    reason === 'extension_not_allowed' ||
    reason === 'mime_not_allowed'
  ) {
    return false;
  }
  return ![
    'FILE_TOO_LARGE',
    'UNSUPPORTED_FILE_TYPE',
    'DOCUMENT_RECORD_EXTENSION_MISMATCH',
    'DOCUMENT_RECORD_FILE_UNCHANGED',
    'DOCUMENT_RECORD_VERSION_MISMATCH',
    'DOCUMENT_RECORD_INVALID_STATE',
    'DOCUMENT_RECORD_REPLACEMENT_INVALID',
    'DOCUMENT_RECORD_REPLACEMENT_LIMIT',
    'DOCUMENT_RECORD_APPROVED_SNAPSHOT_INVALID',
    'DOCUMENT_NOT_CONTROLLED',
    'LEGAL_HOLD_ACTIVE',
    'UPLOAD_INTENT_INVALID',
    'UPLOAD_INTENT_REQUIRED',
    'UPLOAD_INTENT_IN_PROGRESS',
    'UPLOAD_BLOB_ALREADY_BOUND',
    'UPLOAD_BLOB_INVALID',
    'UPLOAD_MIME_MISMATCH',
    'UNAUTHENTICATED',
    'ORG_FORBIDDEN',
    'DOCUMENT_NOT_FOUND',
    'PROJECT_FORBIDDEN',
  ].includes(code ?? '');
}

/**
 * Map an upload rejection to a specific, actionable per-file message.
 *
 * The backend now tags upload rejections with a machine-readable `reasonCode`
 * (see `checkUploadPolicy`) and, for quota/size, the usage numbers. Without
 * this mapping a full per-user volume quota surfaced as the generic
 * "upload failed, check your connection" — making an exhausted quota look like
 * a broken uploader, which is exactly what a trial user reported as
 * "no uploads possible at all anymore". The quota message tells the user to
 * free space, and that failed/interrupted uploads still count against it.
 */
export function mapUploadError(
  err: unknown,
  t: Translate,
  locale?: string,
): string {
  const data = readUploadErrorData(err);
  const reason = data?.reasonCode;
  const code = data?.code;

  if (reason === 'volume_exceeded') {
    return t('upload.quotaExceeded', {
      used: formatBytes(data?.usedBytes ?? 0, locale),
      limit: formatBytes(data?.limitBytes ?? 0, locale),
    });
  }
  if (reason === 'file_too_large' || code === 'FILE_TOO_LARGE') {
    return t('upload.fileTooLargeLimit', {
      limit: formatBytes(data?.limitBytes ?? 0, locale),
    });
  }
  if (code === 'RATE_LIMITED') {
    return t('upload.rateLimited');
  }
  if (code === 'DOCUMENT_RECORD_EXTENSION_MISMATCH') {
    return data?.expectedExtension
      ? t('record.replace.extensionMismatch', {
          extension: data.expectedExtension,
        })
      : t('record.replace.formatMismatch');
  }
  if (code === 'DOCUMENT_RECORD_FILE_UNCHANGED') {
    return t('record.replace.unchanged');
  }
  if (code === 'DOCUMENT_RECORD_VERSION_MISMATCH') {
    return t('record.replace.staleRevision');
  }
  if (code === 'DOCUMENT_RECORD_REPLACEMENT_LIMIT') {
    return t('record.replace.historyLimit');
  }
  if (code === 'DOCUMENT_RECORD_APPROVED_SNAPSHOT_INVALID') {
    return t('record.replace.staleRevision');
  }
  if (
    code === 'DOCUMENT_RECORD_INVALID_STATE' ||
    code === 'DOCUMENT_NOT_CONTROLLED'
  ) {
    return t('record.replace.stateChanged');
  }
  if (code === 'LEGAL_HOLD_ACTIVE') {
    return t('record.replace.blockedByHold');
  }
  if (code === 'UPLOAD_MIME_MISMATCH') {
    return t('record.replace.contentMismatch');
  }
  if (code === 'UPLOAD_INTENT_IN_PROGRESS') {
    return t('record.replace.finalizePending');
  }
  if (
    code === 'UPLOAD_INTENT_INVALID' ||
    code === 'UPLOAD_INTENT_REQUIRED' ||
    code === 'UPLOAD_BLOB_INVALID'
  ) {
    return t('record.replace.intentExpired');
  }
  if (
    reason === 'extension_blocked' ||
    reason === 'extension_not_allowed' ||
    reason === 'mime_not_allowed' ||
    code === 'UNSUPPORTED_FILE_TYPE'
  ) {
    return t('upload.unsupportedFileType');
  }
  return t('upload.uploadFailedRetry');
}
