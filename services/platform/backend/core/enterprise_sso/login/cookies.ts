/**
 * Cookie plumbing for the login doors that answer a raw `Request` (the
 * reused 0.4 protocol handlers) or run before Hono's own cookie helpers are
 * in reach: read one cookie out of a `Cookie` header, tolerating anything
 * the browser — or an attacker — puts in it.
 */

/**
 * The value of cookie `name` in `cookieHeader`, percent-decoded, or
 * `undefined` when absent. A value that is not valid percent-encoding reads
 * as absent too: `decodeURIComponent` throws `URIError` on a stray `%E0`,
 * and a header a client controls must never crash a handler out of its own
 * error-page contract.
 */
export function readCookie(
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${name}=`)) continue;
    const raw = trimmed.slice(name.length + 1);
    try {
      return decodeURIComponent(raw);
    } catch (error) {
      console.warn(
        `[SSO] Ignoring cookie "${name}" with malformed percent-encoding:`,
        error instanceof Error ? error.message : error,
      );
      return undefined;
    }
  }
  return undefined;
}
