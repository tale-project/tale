/**
 * Origin + path join for absolute SEO URLs. Shared by marketing JSON-LD
 * helpers and docs `docUrl` so trailing-slash / slash-join rules cannot
 * drift between services.
 */

/**
 * Join a site origin and a site-relative path into an absolute URL.
 * Trailing slashes on the origin are stripped; the path must be absolute
 * on the host (`/` or `/pricing`). Root path yields `{origin}/`.
 */
export function absoluteSitePath(siteUrl: string, path: string): string {
  const origin = siteUrl.replace(/\/+$/, '');
  if (!path || path === '/') return `${origin}/`;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${normalized}`;
}

/**
 * Derive the docs origin from a site origin by prefixing the host with
 * `docs.` — the same convention `services/proxy/docker-entrypoint.sh`
 * uses when it defaults `DOCS_URL` to `https://docs.${HOST}`. A leading
 * `www.` is dropped first so `https://www.example.com` yields
 * `https://docs.example.com`, not `https://docs.www.example.com`.
 *
 * Port and scheme are preserved, so `https://localhost:3002` yields
 * `https://docs.localhost:3002` — matching the Caddyfile's
 * `https://docs.localhost` dev default.
 *
 * Returns the input unchanged when it is not a parseable absolute URL,
 * so a misconfigured origin degrades to the old value instead of
 * throwing during a build.
 */
export function docsOriginForSite(siteUrl: string): string {
  const trimmed = siteUrl.replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    console.warn(
      `[seo] docsOriginForSite: unparseable siteUrl ${siteUrl}`,
      error,
    );
    return trimmed;
  }
  parsed.hostname = `docs.${parsed.hostname.replace(/^www\./, '')}`;
  return parsed.origin;
}
