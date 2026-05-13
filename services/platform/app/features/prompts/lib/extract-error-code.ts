/**
 * Duck-typed extraction of a `ConvexError` payload's `code` field.
 *
 * Vite chunk splitting can produce multiple `ConvexError` class copies that
 * break `instanceof`, so we never rely on the class identity. We peek at the
 * `data.code` property the server sets via `throw new ConvexError({code, ...})`.
 *
 * Returns the string code (e.g. `'version_conflict'`, `'forbidden'`,
 * `'not_found'`, `'rate_limited'`, `'internal_error'`) when present and
 * recognizable; otherwise `null`.
 */
export function extractErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;

  // Rate-limit errors throw with the literal "Rate limit exceeded" message
  // prefix (RateLimitExceededError) rather than a ConvexError code. Normalize
  // them here so callers don't have to special-case.
  if ('message' in err) {
    const message = (err as { message: unknown }).message;
    if (
      typeof message === 'string' &&
      message.startsWith('Rate limit exceeded')
    ) {
      return 'rate_limited';
    }
  }

  if (!('data' in err)) return null;
  const data = (err as { data: unknown }).data;
  if (!data || typeof data !== 'object' || !('code' in data)) return null;
  const code = (data as { code: unknown }).code;
  return typeof code === 'string' ? code : null;
}
