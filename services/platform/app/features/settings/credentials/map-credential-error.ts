/**
 * Admin-facing message for a failed credential or catalog call, on either the
 * connectors or the AI-providers surface.
 *
 * The credential actions throw structured `ConvexError`s whose `data.message`
 * already names the problem and the fix (the methods a vendor accepts, a name
 * already taken, an endpoint that is not an https origin), so the UI surfaces
 * that message verbatim instead of flattening it to a per-code sentence.
 *
 * Duck-types `ConvexError.data` rather than using `instanceof`: Vite chunk
 * splitting can produce multiple `ConvexError` class copies, and a structured
 * error that failed an identity check would silently degrade to its raw
 * `message` — losing exactly the sentence worth showing.
 */
export function mapCredentialError(err: unknown): string {
  if (err != null && typeof err === 'object' && 'data' in err) {
    const data = (err as { data: unknown }).data;
    if (data != null && typeof data === 'object' && 'message' in data) {
      const message = (data as { message: unknown }).message;
      if (typeof message === 'string' && message.length > 0) return message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
