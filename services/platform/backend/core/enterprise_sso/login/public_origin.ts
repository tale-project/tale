/**
 * The origin the BROWSER is on. Behind the reverse proxy `req.url` carries
 * the internal upstream origin (`http://backend-api:3005` — unreachable from
 * a browser, and `http` even when the deployment terminates TLS), so
 * everything user-facing — redirect targets and the session cookie's
 * `__Secure-`/`Secure` shape (Better Auth derives its cookie name from
 * SITE_URL, `auth/auth.ts`) — must prefer the public SITE_URL and fall back
 * to the request origin only when SITE_URL is unset (dev, tests).
 *
 * The OIDC authorize/callback handlers always did this inline; this is the
 * shared home so the SAML ACS and trusted-headers doors derive it
 * identically. SITE_URL is parsed to its origin (it carries no
 * subpath by contract — the proxy entrypoint substitutes it verbatim), which
 * also normalises a trailing slash away.
 */
export function publicOrigin(requestUrl: string): string {
  const siteUrl = process.env.SITE_URL;
  return siteUrl ? new URL(siteUrl).origin : new URL(requestUrl).origin;
}
