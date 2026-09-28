/**
 * The TypeError `fetch` rejects with when a request gets no answer, in its
 * Chromium, WebKit and Firefox wording. The SDK's fetch instrumentation
 * appends the host (`Failed to fetch (tale.example.com)`). A longer message
 * such as `Failed to fetch dynamically imported module: …` is a stale bundle,
 * a different failure, and does not match.
 */
export const TRANSPORT_FAILURE_RE =
  /^(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.)(?: \([^)]*\))?$/;

/** A request that got no answer at all: refused, offline, a lookup that failed. */
export function isTransportFailure(error: unknown): boolean {
  return error instanceof TypeError && TRANSPORT_FAILURE_RE.test(error.message);
}
