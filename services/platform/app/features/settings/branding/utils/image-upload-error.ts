/**
 * Map a thrown branding `saveImage` error to a `toast` translation key.
 *
 * `saveImage` rejects validation failures with `AppError({ code })`. Vite
 * chunk splitting can produce multiple `AppError` class copies, which breaks
 * `instanceof`, so we duck-type the `data.code` shape instead. Unknown / network
 * errors fall back to a generic upload-failure key.
 */
function readBackendErrorCode(err: unknown): string | undefined {
  if (err == null || typeof err !== 'object') return undefined;
  if (!('data' in err)) return undefined;
  const data = err.data;
  if (data == null || typeof data !== 'object') return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Translation key (within the `toast` namespace) describing why an image upload
 * failed. Returns a specific message for the known validation codes and a
 * generic fallback for everything else (permission, network, server).
 */
export function imageUploadErrorToastKey(err: unknown): string {
  switch (readBackendErrorCode(err)) {
    case 'IMAGE_TOO_LARGE':
      return 'error.imageTooLarge';
    case 'IMAGE_MIME_UNSUPPORTED':
      return 'error.imageMimeUnsupported';
    case 'IMAGE_SVG_ACTIVE_CONTENT':
      return 'error.imageSvgActiveContent';
    case 'IMAGE_TYPE_INVALID':
      return 'error.imageTypeInvalid';
    default:
      return 'error.imageUploadFailed';
  }
}
