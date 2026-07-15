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
  const data = (err as { data: unknown }).data;
  if (data == null || typeof data !== 'object') return undefined;
  return data as UploadErrorData;
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
