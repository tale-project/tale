/**
 * Helpers for the otpauth:// URIs better-auth returns from
 * `/two-factor/enable`. Kept in a shared module so the in-settings
 * enrollment dialog and the post-grace enrollment wall stay in sync.
 */

export function extractSecret(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get('secret');
  } catch {
    return null;
  }
}

/**
 * Normalize a better-auth-generated otpauth URI to maximize scanner
 * compatibility:
 *
 * 1. Decode `%40` → `@` in the label. better-auth encodes the account
 *    email via `encodeURIComponent`, which percent-encodes `@`. Several
 *    scanners (e.g. 端隐) don't percent-decode the label before
 *    validating the account name as an email and reject URIs that
 *    contain `%40`. Per RFC 3986, `@` is allowed unencoded in path
 *    segments (pchar), so this is always safe. Aligns with what
 *    GitHub / Microsoft emit.
 *
 * 2. Fill in `algorithm`, `digits`, and `period` when the server omits
 *    them. The KeyURI spec gives these defaults (SHA1 / 6 / 30), but
 *    some older / stricter apps refuse URIs that don't spell them out.
 */
export function normalizeOtpauthURI(uri: string): string {
  const qIndex = uri.indexOf('?');
  const prefix = qIndex < 0 ? uri : uri.slice(0, qIndex);
  const queryStr = qIndex < 0 ? '' : uri.slice(qIndex + 1);

  const friendlyPrefix = prefix.replace(/%40/gi, '@');

  const params = new URLSearchParams(queryStr);
  if (!params.has('algorithm')) params.set('algorithm', 'SHA1');
  if (!params.has('digits')) params.set('digits', '6');
  if (!params.has('period')) params.set('period', '30');

  return queryStr ? `${friendlyPrefix}?${params.toString()}` : friendlyPrefix;
}
