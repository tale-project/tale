/**
 * Admin-facing message for a failed provider-credential or catalog call.
 *
 * The credential actions throw structured `ConvexError`s whose `data.message`
 * already names the problem and the fix (offered auth methods, the env-name
 * namespace, per-field broker issues), so the UI surfaces that message
 * verbatim instead of flattening it to a per-code sentence. Duck-types
 * `ConvexError.data` because Vite chunk splitting can produce multiple
 * `ConvexError` class copies that break `instanceof` — same rationale as
 * `org-residency-errors.ts`.
 */
export function mapProviderError(err: unknown): string {
  if (err != null && typeof err === 'object' && 'data' in err) {
    const data = (err as { data: unknown }).data;
    if (data != null && typeof data === 'object' && 'message' in data) {
      const message = (data as { message: unknown }).message;
      if (typeof message === 'string' && message.length > 0) return message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}
