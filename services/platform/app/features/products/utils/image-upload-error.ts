/**
 * Map a refused product image upload to its `products.edit.*` message key —
 * the branding form's `imageUploadErrorToastKey` precedent. The hook throws
 * an `AppError` carrying the door's `{ code }`; Vite chunk splitting can
 * produce several `AppError` copies, so the shape is duck-typed, and an
 * unknown or network failure keeps the generic "try again".
 */
function readUploadErrorCode(err: unknown): string | undefined {
  if (err == null || typeof err !== 'object' || !('data' in err))
    return undefined;
  const data = err.data;
  if (data == null || typeof data !== 'object') return undefined;
  const code = (data as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function productImageUploadErrorKey(err: unknown): string {
  switch (readUploadErrorCode(err)) {
    case 'PRODUCT_IMAGE_ACTIVE_CONTENT':
      return 'edit.imageActiveContent';
    case 'PRODUCT_IMAGE_INVALID':
      return 'edit.imageUnsupported';
    case 'FILE_SIZE_INVALID':
      return 'edit.imageTooLarge';
    default:
      return 'edit.imageUploadFailed';
  }
}
