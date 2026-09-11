import type { Context, Env, MiddlewareHandler, NotFoundHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

/**
 * The request-level hygiene every backend response shares, independent of
 * which door answers: the NUL-byte refusal, the JSON 404 for the API
 * prefix, and the transport-security headers. Kept apart from `app.ts` so
 * each rule is a unit under test rather than a line inside the wiring.
 */

/**
 * A NUL in a URL is never a valid path segment or query value here, and
 * Postgres refuses it in every text column (`22021`) — a `GET /documents/
 * a%00b` used to reach the driver and answer a text/plain 500. Refused as
 * the client mistake it is, before any door decodes it into a lookup.
 */
export function nulUrlGuard<E extends Env>(): MiddlewareHandler<E> {
  return async (c, next) => {
    if (/%00/i.test(c.req.url) || c.req.path.includes('\0')) {
      return c.json(
        {
          error: 'The request URL contains a NUL character (U+0000)',
          code: 'INVALID_URL',
        },
        400,
      );
    }
    return next();
  };
}

/**
 * A path nobody serves under `/api/` answers the JSON envelope every API
 * door documents, never Hono's text/plain default — a mistyped prefix
 * (`/api/v2/…`) or an unrouted app path still speaks the contract. Other
 * paths keep the framework's plain 404.
 */
export const apiNotFound: NotFoundHandler = (c: Context) =>
  c.req.path.startsWith('/api/')
    ? c.json({ error: 'Not found', code: 'NOT_FOUND' }, 404)
    : c.text('404 Not Found', 404);

/**
 * The transport-security headers every backend response carries — the
 * proxy delegates them to the app tier, which never sees `/api/*`. No CSP
 * (these are JSON, XML and blob responses, not documents) and the
 * cross-origin isolation defaults off, as on the app's WebDAV variant:
 * OAuth callbacks and SSO hand-offs render in popups and top-level
 * navigations that COOP/CORP would break. HSTS only when the deployment is
 * served over https — a plain-http dev origin must not pin browsers.
 */
export function backendSecureHeaders<E extends Env>(
  siteUrl: string | undefined,
): MiddlewareHandler<E> {
  return secureHeaders({
    strictTransportSecurity: (siteUrl ?? '').startsWith('https://')
      ? 'max-age=15552000'
      : false,
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    referrerPolicy: 'strict-origin-when-cross-origin',
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  });
}
