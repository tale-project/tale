import {
  canonicalSiteOrigin,
  requestSiteOrigin,
  resolveSiteOrigins,
} from '@tale/shared/utils/site-urls';

/**
 * The origin the BROWSER is on — the one home for that answer across every
 * door that mints a cookie, builds a redirect or hands a vendor a callback
 * URL (OIDC authorize/callback, SAML login/ACS, trusted headers, connector
 * and cloud-import OAuth).
 *
 * Behind the reverse proxy `req.url` carries the internal upstream origin
 * (`http://backend-api:3005` — unreachable from a browser, and `http` even
 * when the deployment terminates TLS), so the answer comes from the
 * deployment's configuration, in this order:
 *
 *   1. The origin the request's `Host` + `X-Forwarded-Proto` name, IF it is
 *      one of the configured site origins (`SITE_URL` or an entry of
 *      `ADDITIONAL_SITE_URLS`). Multi-domain deployments keep every browser
 *      on the domain it arrived on: its cookies, its redirects, the callback
 *      URL registered for it.
 *   2. The canonical `SITE_URL` origin — a `Host` outside the configured set
 *      is never honoured, so `Host`-header injection cannot move a redirect
 *      or an OAuth callback off the deployment. This is also the single-
 *      domain answer, unchanged from before additional origins existed.
 *   3. The request URL's own origin, only when `SITE_URL` is unset (dev,
 *      tests).
 */
export function publicOrigin(req: Request): string {
  const origins = siteOrigins();
  const matched = requestSiteOrigin(
    {
      url: req.url,
      host: req.headers.get('host'),
      forwardedProto: req.headers.get('x-forwarded-proto'),
    },
    origins,
  );
  if (matched !== null) return matched;
  return origins[0] ?? new URL(req.url).origin;
}

/**
 * Every origin this deployment answers on, canonical first — empty when
 * `SITE_URL` is unset. Read from the process env on each call so the doors
 * see a change the moment the container's env does (and so tests can set
 * the variables per case, as they always have).
 */
export function siteOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return resolveSiteOrigins({
    SITE_URL: env.SITE_URL,
    ADDITIONAL_SITE_URLS: env.ADDITIONAL_SITE_URLS,
  });
}

/** The canonical `SITE_URL` origin, or null when unset. */
export function canonicalOrigin(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return canonicalSiteOrigin(env.SITE_URL);
}

/** `BASE_PATH` with its trailing slash trimmed (empty for root deployments). */
export function basePath(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BASE_PATH ?? '').replace(/\/$/, '');
}

/**
 * `<origin><BASE_PATH>` — the browser-facing base every absolute app URL is
 * built on — for the request's public origin. Null when `SITE_URL` is unset:
 * the OAuth doors refuse to derive a callback from an unconfigured
 * deployment rather than guess one from the request (guessing is what makes
 * `Host`-header injection work).
 */
export function publicBaseUrl(req: Request): string | null {
  if (siteOrigins().length === 0) return null;
  return `${publicOrigin(req)}${basePath()}`;
}

/**
 * `<origin><BASE_PATH>` for one configured origin (the admin surfaces list
 * the URLs to register for every domain a deployment answers on).
 */
export function publicBaseUrlFor(origin: string): string {
  return `${origin}${basePath()}`;
}

/**
 * The public base of the backend's `/http_api` lane for one origin — the
 * shape the SSO doors publish to identity providers, per domain.
 */
export function publicHttpApiUrlFor(origin: string): string {
  return `${publicBaseUrlFor(origin)}/http_api`;
}
