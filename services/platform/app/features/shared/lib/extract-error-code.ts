/**
 * Duck-typed extraction of a `ConvexError` payload's `code` field.
 *
 * Vite chunk splitting can produce multiple `ConvexError` class copies that
 * break `instanceof`, so we never rely on the class identity. We peek at the
 * `data.code` property the server sets via `throw new ConvexError({code, ...})`.
 *
 * Returns the string code (e.g. `'version_conflict'`, `'forbidden'`,
 * `'not_found'`, `'rate_limited'`) when present and recognizable; otherwise
 * `null`.
 */
export function extractErrorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;

  // Rate-limit errors are thrown as plain Error (RateLimitExceededError) with
  // message "Rate limit exceeded for ...". Convex wraps non-ConvexError throws
  // over the wire as "[Request ID: xxx] Server Error\nUncaught Error: Rate
  // limit exceeded for ...", so substring match (not startsWith) is required.
  if ('message' in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === 'string' && /Rate limit exceeded/.test(message)) {
      return 'rate_limited';
    }
  }

  if (!('data' in err)) return null;
  const data = (err as { data: unknown }).data;
  if (!data || typeof data !== 'object' || !('code' in data)) return null;
  const code = (data as { code: unknown }).code;
  return typeof code === 'string' ? code : null;
}
