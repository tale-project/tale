interface RobotsParams {
  /** Sitemap URLs to declare. */
  sitemaps: readonly string[];
  /** Path patterns to disallow (default `[]`). */
  disallow?: readonly string[];
  /** User agents the rules apply to (default `*`). */
  userAgent?: string;
}

export function buildRobotsTxt({
  sitemaps,
  disallow = [],
  userAgent = '*',
}: RobotsParams): string {
  const lines: string[] = [`User-agent: ${userAgent}`];
  if (disallow.length === 0) {
    lines.push('Allow: /');
  } else {
    for (const path of disallow) {
      lines.push(`Disallow: ${path}`);
    }
  }
  lines.push('');
  for (const url of sitemaps) {
    lines.push(`Sitemap: ${url}`);
  }
  lines.push('');
  return lines.join('\n');
}
