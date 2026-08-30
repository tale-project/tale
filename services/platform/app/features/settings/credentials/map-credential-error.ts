/**
 * Admin-facing message for a failed credential or catalog call, on either the
 * connectors or the AI-providers surface.
 *
 * The credential actions throw structured `AppError`s whose `data.message`
 * already names the problem and the fix (the methods a vendor accepts, a name
 * already taken, an endpoint that is not an https origin), so the UI surfaces
 * that message verbatim instead of flattening it to a per-code sentence.
 *
 * Duck-types `AppError.data` rather than using `instanceof`: Vite chunk
 * splitting can produce multiple `AppError` class copies, and a structured
 * error that failed an identity check would silently degrade to its raw
 * `message` — losing exactly the sentence worth showing.
 *
 * Unstructured Convex action failures arrive as dumps (`[CONVEX A(…)]`,
 * `Server Error`, absolute module paths). Those are for the console, not the
 * Alert — replace them with a short reload hint so Settings stays readable.
 */

/** True when a string is a Convex/runtime dump, not a product sentence. */
export function isOpaqueServerErrorMessage(message: string): boolean {
  return (
    /\[Request ID:/i.test(message) ||
    /\[CONVEX [AQCOP]\(/i.test(message) ||
    /Server Error/i.test(message) ||
    /Cannot find module/i.test(message) ||
    /\/var\/folders\//i.test(message) ||
    /Called by client/i.test(message)
  );
}

const OPAQUE_FALLBACK = 'Something went wrong. Reload and try again.';

export function mapCredentialError(err: unknown): string {
  if (err != null && typeof err === 'object' && 'data' in err) {
    const data = err.data;
    if (data != null && typeof data === 'object' && 'message' in data) {
      const message = data.message;
      if (typeof message === 'string' && message.length > 0) {
        return isOpaqueServerErrorMessage(message) ? OPAQUE_FALLBACK : message;
      }
    }
  }
  const fallback = err instanceof Error ? err.message : String(err);
  return isOpaqueServerErrorMessage(fallback) ? OPAQUE_FALLBACK : fallback;
}
