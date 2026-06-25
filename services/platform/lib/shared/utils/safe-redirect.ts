/**
 * Redirect-target hardening shared by the auth flows. A redirect parameter a
 * user can influence must resolve to a path on our own origin — never an
 * attacker-controlled absolute or protocol-relative URL (open redirect /
 * phishing). See issue #2037.
 */

const RESOLVE_BASE = 'https://internal.invalid';

/**
 * True when `value` is a safe root-relative path on our own origin: a single
 * leading slash, no scheme, and no protocol-relative (`//`) or backslash (`/\`)
 * host smuggling. Query string and fragment are allowed.
 */
export function isSafeInternalPath(value: string): boolean {
  if (!value.startsWith('/')) return false;
  // `//evil.com` and `/\evil.com` are read as a host by browsers (the latter
  // because URL parsing folds `\` to `/` for http(s) schemes). Reject both.
  if (value.length > 1 && (value[1] === '/' || value[1] === '\\')) return false;
  // Defence in depth: resolved against a fixed origin, a safe path must not
  // escape it.
  try {
    return new URL(value, RESOLVE_BASE).origin === RESOLVE_BASE;
  } catch {
    return false;
  }
}

/**
 * Return `raw` when it is a safe root-relative path, otherwise `fallback`.
 * `fallback` is trusted (caller-constructed) and returned as-is.
 */
export function sanitizeInternalRedirect(
  raw: string | null | undefined,
  fallback: string,
): string {
  return typeof raw === 'string' && isSafeInternalPath(raw) ? raw : fallback;
}
