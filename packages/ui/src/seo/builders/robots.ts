/**
 * `robots.txt` builder. Emits a minimal `User-agent` + `Allow` + `Disallow`
 * block followed by one `Sitemap:` line per provided sitemap URL.
 *
 * The default disallow list covers private endpoints that are never useful
 * for crawlers (`/api/`, `/_search/`). Callers can extend it through
 * `disallow` or `extraDisallow` without losing the defaults.
 */

interface RobotsParams {
  /** Sitemap URLs to declare. */
  sitemaps: readonly string[];
  /** Path patterns to disallow. Merged with `DEFAULT_DISALLOW`. */
  disallow?: readonly string[];
  /** Additional path patterns. Merged after `disallow`, duplicates dropped. */
  extraDisallow?: readonly string[];
  /** User agent the rules apply to. Defaults to `*`. */
  userAgent?: string;
}

const DEFAULT_DISALLOW: readonly string[] = ['/api/', '/_search/'];

export function buildRobotsTxt({
  sitemaps,
  disallow = [],
  extraDisallow = [],
  userAgent = '*',
}: RobotsParams): string {
  const lines: string[] = [`User-agent: ${userAgent}`, 'Allow: /'];

  // Set preserves insertion order and dedupes in O(n).
  const merged = new Set<string>([
    ...DEFAULT_DISALLOW,
    ...disallow,
    ...extraDisallow,
  ]);
  for (const path of merged) lines.push(`Disallow: ${path}`);

  lines.push('');
  for (const url of sitemaps) lines.push(`Sitemap: ${url}`);
  lines.push('');

  return lines.join('\n');
}
