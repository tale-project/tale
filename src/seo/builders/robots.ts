/**
 * `robots.txt` builder. Emits a minimal `User-agent` block — `Allow` lines,
 * then `Disallow` lines — followed by one `Sitemap:` line per provided
 * sitemap URL.
 *
 * The default disallow list covers private endpoints that are never useful
 * for crawlers (`/api/`, `/_search/`). Callers can extend it through
 * `disallow` or `extraDisallow` without losing the defaults, and can carve
 * public paths out of a blanket `Disallow: /` through `allow`.
 *
 * `Allow: /` is emitted only while `/` is NOT disallowed: an authenticated
 * surface that blocks the whole host used to get both `Allow: /` and
 * `Disallow: /` in one group — a contradiction simpler crawlers resolve as
 * "everything disallowed" (2026-09-14 evaluation, g9-1). Google's
 * longest-match-then-Allow rule makes an explicit `Allow: /docs` beside
 * `Disallow: /` mean exactly what it says, so the public developer pages of
 * an app host can be listed while the app itself stays out of the index.
 */

interface RobotsParams {
  /** Sitemap URLs to declare. */
  sitemaps: readonly string[];
  /** Path patterns to disallow. Merged with `DEFAULT_DISALLOW`. */
  disallow?: readonly string[];
  /** Additional path patterns. Merged after `disallow`, duplicates dropped. */
  extraDisallow?: readonly string[];
  /** Path patterns to allow explicitly — the carve-outs of a blanket
   * `Disallow: /`. Emitted before the disallow lines, duplicates dropped. */
  allow?: readonly string[];
  /** User agent the rules apply to. Defaults to `*`. */
  userAgent?: string;
}

const DEFAULT_DISALLOW: readonly string[] = ['/api/', '/_search/'];

export function buildRobotsTxt({
  sitemaps,
  disallow = [],
  extraDisallow = [],
  allow = [],
  userAgent = '*',
}: RobotsParams): string {
  // Set preserves insertion order and dedupes in O(n).
  const merged = new Set<string>([
    ...DEFAULT_DISALLOW,
    ...disallow,
    ...extraDisallow,
  ]);
  const allowed = new Set<string>(allow);
  const lines: string[] = [`User-agent: ${userAgent}`];
  if (!merged.has('/')) lines.push('Allow: /');
  for (const path of allowed) lines.push(`Allow: ${path}`);
  for (const path of merged) lines.push(`Disallow: ${path}`);

  lines.push('');
  for (const url of sitemaps) lines.push(`Sitemap: ${url}`);
  lines.push('');

  return lines.join('\n');
}
