/**
 * Turn a browser session's Netscape cookie jar into a `Cookie:` header value for
 * a given URL, and derive the domain key a consumer claims a session under.
 * These let any server-side fetch (crawler, web-fetch tool) present a pooled
 * session's cookies without a browser.
 */

/**
 * Registrable-domain key for session claiming (approximate eTLD+1: the last two
 * labels). `www.youtube.com` and `m.youtube.com` both map to `youtube.com`, so
 * a session warmed for one host serves the others. Multi-part TLDs (`co.uk`)
 * are not special-cased — operators import under the exact key they want; this
 * only needs to be consistent between import and claim.
 */
export function registrableDomain(hostname: string): string {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  return labels.slice(-2).join('.');
}

export interface ParsedCookie {
  /** Host without a leading dot (e.g. `youtube.com`). */
  domain: string;
  includeSubdomains: boolean;
  path: string;
  /** Unix seconds; `0` means a session cookie. */
  expiry: number;
  name: string;
  value: string;
  secure: boolean;
  httpOnly: boolean;
}

/**
 * Parse a Netscape-format cookie jar (yt-dlp / curl / browser-export layout: 7
 * tab-separated fields per line). Blank lines and comments are skipped, except
 * the `#HttpOnly_` prefix some exporters prepend — that marks an HttpOnly cookie
 * and is stripped so the cookie is still parsed.
 */
export function parseNetscapeJar(jar: string): ParsedCookie[] {
  const cookies: ParsedCookie[] = [];
  for (const rawLine of jar.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || (line.startsWith('#') && !line.startsWith('#HttpOnly_'))) {
      continue;
    }
    const httpOnly = line.startsWith('#HttpOnly_');
    const cleaned = line.replace(/^#HttpOnly_/, '');
    const parts = cleaned.split('\t');
    if (parts.length < 7) continue;
    const [domain, includeSub, path, secureStr, expiryStr, name, value] = parts;
    if (!name) continue;
    cookies.push({
      domain: domain.toLowerCase().replace(/^\./, ''),
      includeSubdomains: includeSub.toUpperCase() === 'TRUE',
      path: path || '/',
      secure: secureStr.toUpperCase() === 'TRUE',
      expiry: Number(expiryStr) || 0,
      name,
      value,
      httpOnly,
    });
  }
  return cookies;
}

/**
 * Build the `Cookie:` header value from `jar` for `targetUrl`: cookies whose
 * domain and path match the URL and that haven't expired, joined `name=value`.
 * Returns `''` when nothing matches. `nowMs` is injectable for tests.
 */
export function netscapeJarToCookieHeader(
  jar: string,
  targetUrl: string,
  nowMs: number = Date.now(),
): string {
  let host: string;
  let path: string;
  try {
    const u = new URL(targetUrl);
    host = u.hostname.toLowerCase();
    path = u.pathname || '/';
  } catch {
    return '';
  }
  const nowSec = Math.floor(nowMs / 1000);
  const pairs: string[] = [];
  for (const c of parseNetscapeJar(jar)) {
    if (c.expiry !== 0 && c.expiry <= nowSec) continue; // expired (0 = session)
    const domainOk =
      host === c.domain ||
      (c.includeSubdomains && host.endsWith(`.${c.domain}`)) ||
      host.endsWith(`.${c.domain}`);
    if (!domainOk) continue;
    if (!path.startsWith(c.path)) continue;
    pairs.push(`${c.name}=${c.value}`);
  }
  return pairs.join('; ');
}
