/**
 * The public origins one deployment answers on.
 *
 * `SITE_URL` is the canonical origin: the single stable value every
 * request-less context uses (email deep links, SCIM `meta.location`, the SAML
 * SP entityID, the default object-store public endpoint, the passkey Relying
 * Party ID). `ADDITIONAL_SITE_URLS` lists the other origins the SAME
 * deployment is served from, comma- or whitespace-separated. Every listed
 * origin is a first-class entry point: the proxy answers on it, Better Auth
 * trusts it, the SPA is told it is the site URL, and a browser-facing absolute
 * URL derived from a request uses the origin the browser is actually on.
 *
 * The list is an allow-list, never a guess: a `Host` header naming anything
 * else resolves to the canonical origin, so `Host`-header injection cannot
 * point a redirect or an OAuth callback off the deployment.
 *
 * Shared by the web tier (`server.ts`), the backend and the SPA's env typing
 * so the three never disagree on what counts as "this deployment".
 */

export const SITE_URL_ENV = 'SITE_URL';
export const ADDITIONAL_SITE_URLS_ENV = 'ADDITIONAL_SITE_URLS';

/** Thrown for a malformed `ADDITIONAL_SITE_URLS` entry — the message names it. */
export class SiteUrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SiteUrlConfigError';
  }
}

/**
 * Split the raw list value on commas and whitespace. Entries are trimmed,
 * empties dropped; nothing is validated here.
 */
export function splitSiteUrlList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * One configured additional origin, normalized to `URL.origin` (lower-cased
 * host, default port dropped, trailing slash gone). Refuses anything that is
 * not an absolute http(s) URL or that carries a path, query or fragment —
 * the value names an ORIGIN; a subpath belongs in `BASE_PATH`, and a typo
 * here must fail boot rather than silently serve nobody.
 */
export function normalizeSiteOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SiteUrlConfigError(
      `${ADDITIONAL_SITE_URLS_ENV}: "${value}" is not an absolute URL (expected e.g. https://tale.example.com)`,
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SiteUrlConfigError(
      `${ADDITIONAL_SITE_URLS_ENV}: "${value}" must use http:// or https://`,
    );
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new SiteUrlConfigError(
      `${ADDITIONAL_SITE_URLS_ENV}: "${value}" must be a bare origin (scheme, host and optional port) — a subpath belongs in BASE_PATH`,
    );
  }
  return url.origin;
}

/**
 * The configured additional origins, normalized and deduplicated, in the
 * order written. Throws {@link SiteUrlConfigError} on the first bad entry.
 */
export function parseAdditionalSiteUrls(
  raw: string | null | undefined,
): string[] {
  const origins: string[] = [];
  for (const entry of splitSiteUrlList(raw)) {
    const origin = normalizeSiteOrigin(entry);
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/**
 * The canonical origin, or null when `SITE_URL` is unset or unparsable.
 * Deliberately lenient (a trailing slash or a stray path is tolerated, as
 * every consumer always did) — the canonical value has a decade of `.env`
 * files behind it and must never start failing boot.
 */
export function canonicalSiteOrigin(
  siteUrl: string | null | undefined,
): string | null {
  const trimmed = siteUrl?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

export interface SiteOriginsEnv {
  SITE_URL?: string | undefined;
  ADDITIONAL_SITE_URLS?: string | undefined;
}

/**
 * Every origin this deployment answers on — the canonical one first, then
 * the additional ones (deduplicated against it). Empty when `SITE_URL` is
 * unset: without a canonical origin there is no deployment identity to
 * extend, and the additional list is ignored rather than promoted.
 */
export function resolveSiteOrigins(env: SiteOriginsEnv): string[] {
  const canonical = canonicalSiteOrigin(env.SITE_URL);
  if (canonical === null) return [];
  const origins = [canonical];
  for (const origin of parseAdditionalSiteUrls(env.ADDITIONAL_SITE_URLS)) {
    if (!origins.includes(origin)) origins.push(origin);
  }
  return origins;
}

/**
 * The configured origin `candidate` names, or null. `candidate` is anything
 * a caller could hand us (a `Host`-derived URL, a redirect target); it is
 * parsed to its origin and compared exactly — scheme, host and port — so a
 * look-alike (`tale.example.com.evil.example`) or a scheme downgrade never
 * matches.
 */
export function matchSiteOrigin(
  candidate: string | null | undefined,
  origins: readonly string[],
): string | null {
  if (!candidate) return null;
  let origin: string;
  try {
    origin = new URL(candidate).origin;
  } catch {
    return null;
  }
  return origins.includes(origin) ? origin : null;
}

export interface RequestOriginInput {
  /** The request URL as the server saw it (behind the proxy: the internal upstream). */
  url: string;
  /** The `Host` header — behind Caddy, the public host the browser addressed. */
  host?: string | null | undefined;
  /** `X-Forwarded-Proto` — the scheme the browser used, set by the proxy. */
  forwardedProto?: string | null | undefined;
}

/**
 * The public origin the browser is on for a proxied request, IF it is one
 * of the configured site origins — otherwise null. The proxy forwards the
 * browser's `Host` verbatim and stamps `X-Forwarded-Proto`; both are
 * consulted only to pick among `origins`, never trusted on their own.
 * Without a forwarded scheme the request URL's own scheme stands in (a
 * direct, unproxied request), and without a `Host` header its host does.
 */
export function requestSiteOrigin(
  input: RequestOriginInput,
  origins: readonly string[],
): string | null {
  if (origins.length === 0) return null;
  let requestUrl: URL;
  try {
    requestUrl = new URL(input.url);
  } catch {
    return null;
  }
  const host = input.host?.trim() || requestUrl.host;
  const proto =
    input.forwardedProto?.split(',')[0]?.trim().toLowerCase() ||
    requestUrl.protocol.replace(/:$/, '');
  if (proto !== 'https' && proto !== 'http') return null;
  return matchSiteOrigin(`${proto}://${host}`, origins);
}
