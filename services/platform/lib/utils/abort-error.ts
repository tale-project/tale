/**
 * Whether a rejection is a CANCELLATION: what a `fetch` (or anything else
 * that honours an `AbortSignal`) settles with once its caller aborted it —
 * TanStack Query aborting a read whose last observer unmounted, a dialog
 * cancelling its upload. Chromium rejects an aborted fetch with a
 * `DOMException` named `AbortError`: "signal is aborted without reason"
 * while the response is awaited, "The user aborted a request." while its
 * body streams. A cancellation says nothing about the server and is nobody's
 * failure.
 *
 * Checked by `name`, not `instanceof DOMException`: a DOMException from
 * another realm fails `instanceof`, and a polyfilled or server-side abort is
 * a plain `Error` carrying that name.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AbortError'
  );
}
