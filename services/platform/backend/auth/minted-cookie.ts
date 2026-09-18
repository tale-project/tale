/**
 * A session minted on THIS request, before the gates ran — the transparent
 * sign-in from an authenticating proxy's headers
 * (`domains/sso/trusted-headers.ts`). The browser only learns the cookie
 * from the response, so the request it sent carries none; the gates read
 * the request as if it had, through the two helpers below. Keyed by the
 * request object itself, so nothing about it leaks into Hono's typed
 * variables or outlives the request.
 */
const mintedCookies = new WeakMap<Request, string>();

/** Remember the `name=value` minted for this request. */
export function rememberMintedCookie(req: Request, cookiePair: string): void {
  if (cookiePair !== '') mintedCookies.set(req, cookiePair);
}

/** The request headers, with the minted `name=value` added to `Cookie`. */
export function headersWithMintedCookie(req: Request): Headers {
  const minted = mintedCookies.get(req);
  const headers = new Headers(req.headers);
  if (minted !== undefined) {
    const existing = headers.get('cookie');
    headers.set('cookie', existing ? `${existing}; ${minted}` : minted);
  }
  return headers;
}

/** The request itself, re-headed the same way — for handlers that take a
 * `Request` rather than headers (Better Auth's own). */
export function requestWithMintedCookie(req: Request): Request {
  if (!mintedCookies.has(req)) return req;
  return new Request(req, { headers: headersWithMintedCookie(req) });
}
