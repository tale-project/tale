/** Raised when an upload stalls or a mutation exceeds its deadline. */
export class UploadTimeoutError extends Error {
  constructor(message = 'Upload timed out') {
    super(message);
    this.name = 'UploadTimeoutError';
  }
}

/**
 * Race `promise` against a timeout and an optional abort signal. Rejects with
 * `UploadTimeoutError` on deadline, or an `AbortError` `DOMException` if the
 * signal fires first — so a hung Convex mutation can never wedge the
 * sequential upload loop (which would leave the dialog's `isUploading` latch
 * stuck and block all further uploads).
 *
 * The underlying call is NOT cancelled — we only stop waiting. Convex mutations
 * are idempotent enough here: a create that lands late simply makes the
 * document appear.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new UploadTimeoutError()), ms);
    const onAbort = () =>
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    promise.then(
      (value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
