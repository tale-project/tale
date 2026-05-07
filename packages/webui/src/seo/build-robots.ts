interface RobotsParams {
  /** Sitemap URLs to declare. */
  sitemaps: readonly string[];
  /** Path patterns to disallow (default `[]`). */
  disallow?: readonly string[];
  /** Additional path patterns to disallow, merged with defaults & `disallow`. */
  extraDisallow?: readonly string[];
  /** User agents the rules apply to (default `*`). */
  userAgent?: string;
}

const DEFAULT_DISALLOW: readonly string[] = ['/api/', '/_search/'];

export function buildRobotsTxt({
  sitemaps,
  disallow = [],
  extraDisallow = [],
  userAgent = '*',
}: RobotsParams): string {
  const lines: string[] = [`User-agent: ${userAgent}`];
  lines.push('Allow: /');
  const merged: string[] = [];
  for (const path of [...DEFAULT_DISALLOW, ...disallow, ...extraDisallow]) {
    if (!merged.includes(path)) {
      merged.push(path);
    }
  }
  for (const path of merged) {
    lines.push(`Disallow: ${path}`);
  }
  lines.push('');
  for (const url of sitemaps) {
    lines.push(`Sitemap: ${url}`);
  }
  lines.push('');
  return lines.join('\n');
}
