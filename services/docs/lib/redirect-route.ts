/**
 * The docs server's 301 route: answers every address `resolveRedirect` maps
 * (moved pages, section folders, `/en` and localized `llms.txt` aliases)
 * before static serving, under the public mount prefix with the query
 * string kept; a page that moved to another site is sent there as is. What
 * is still unanswered after static serving goes to `lib/near-miss.ts`. Kept
 * apart from `lib/redirects.ts` because that module also feeds the
 * prerender script, which needs no HTTP or cookie code.
 */

import { redirectLocation } from '@tale/ui/docs/redirects';
import { serializeLocaleCookie } from '@tale/ui/i18n/cookie';
import { isSecureRequest } from '@tale/ui/server';

import { isEnglishPageAlias, resolveRedirect } from './redirects';

interface RedirectRouteOptions {
  /** Old → new URL paths from `buildRedirectPathMap`. */
  paths: ReadonlyMap<string, string>;
  /** Public mount prefix without a trailing slash (`''` or `/docs`). */
  basePath: string;
  /** Locale-cookie domain, shared with the server's own negotiation. */
  localeCookieDomain?: string;
}

/** Build the `extraRoutes` handler that serves the docs redirects. */
export function createRedirectRoute({
  paths,
  basePath,
  localeCookieDomain,
}: RedirectRouteOptions): (request: Request, url: URL) => Response | null {
  return (request, url) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return null;
    const target = resolveRedirect(url.pathname, paths);
    if (!target) return null;
    const headers = new Headers({
      Location: redirectLocation(target, basePath, url.search),
    });
    // `/en/<page>` names English, but its unprefixed target is negotiated
    // again: pin the English cookie so a `de`/`fr` cookie or Accept-Language
    // cannot send the reader on, and keep browsers from reusing the answer
    // without the cookie it carries.
    if (isEnglishPageAlias(url.pathname)) {
      headers.append(
        'Set-Cookie',
        serializeLocaleCookie({
          value: 'en',
          domain: localeCookieDomain,
          secure: isSecureRequest(request),
        }),
      );
      headers.set('Cache-Control', 'no-cache');
    }
    return new Response(null, { status: 301, headers });
  };
}
