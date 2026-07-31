/**
 * The pure half of the crawler: parsing robots.txt, sitemaps, and page links,
 * and deciding which URLs belong to a scan.
 *
 * Everything here is deterministic string work — no fetching, no SQL — so the
 * crawl engine's judgment calls (what counts as the same site, what a robots
 * rule blocks, which links survive) are pinned by fast tests instead of being
 * exercised only against the live web.
 */

/** What robots.txt tells a well-behaved crawler: the paths disallowed for
 * everyone (`User-agent: *`), and any sitemap locations it advertises. */
export interface RobotsRules {
  readonly disallow: readonly string[];
  readonly sitemaps: readonly string[];
}

/** Parse robots.txt, honouring the `*` agent group only — this crawler has
 * no registered agent name, so the wildcard group is the one that binds. */
export function parseRobots(text: string): RobotsRules {
  const disallow: string[] = [];
  const sitemaps: string[] = [];
  let inWildcardGroup = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line.length === 0) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'user-agent') {
      inWildcardGroup = value === '*';
      continue;
    }
    if (field === 'sitemap' && value.length > 0) {
      sitemaps.push(value);
      continue;
    }
    if (field === 'disallow' && inWildcardGroup && value.length > 0) {
      disallow.push(value);
    }
  }
  return { disallow, sitemaps };
}

/** True when a robots `Disallow` prefix blocks this path. The `*` wildcard
 * inside rules is honoured as "any run of characters" (the de-facto
 * extension every major engine implements). */
export function isDisallowed(
  pathname: string,
  disallow: readonly string[],
): boolean {
  for (const rule of disallow) {
    if (rule.includes('*')) {
      const pattern = rule
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
      if (new RegExp(`^${pattern}`).test(pathname)) return true;
    } else if (pathname.startsWith(rule)) {
      return true;
    }
  }
  return false;
}

/** `<loc>` entries of a sitemap or sitemap-index document. */
export function parseSitemapLocs(xml: string): string[] {
  const locs: string[] = [];
  for (const match of xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const value = (match[1] ?? '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .trim();
    if (value.length > 0) locs.push(value);
  }
  return locs;
}

/** True for a sitemap INDEX document (its locs are more sitemaps). */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/** `href` targets of a page's anchors, as written. */
export function extractLinks(html: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(
    /<a\s[^>]*href\s*=\s*("([^"]*)"|'([^']*)')/gi,
  )) {
    const href = (match[2] ?? match[3] ?? '').trim();
    if (href.length > 0) links.push(href);
  }
  return links;
}

/** File suffixes a text crawler never fetches. */
const SKIPPED_SUFFIXES =
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|rss|atom|pdf|zip|gz|tar|mp[34]|webm|mov|avi|woff2?|ttf|eot|docx?|xlsx?|pptx?)$/i;

/**
 * Normalize a candidate URL onto the crawl's own site, or return null when
 * it leaves it. `hosts` names the hostnames that count as this site (the
 * registered domain plus its www/apex sibling). Fragments drop; queries are
 * KEPT (many sites route content through them); non-http(s) schemes and
 * asset suffixes drop. `http:` upgrades to `https:` — sitemaps routinely
 * advertise plaintext URLs for sites that serve only TLS, and the fetcher
 * refuses plaintext to public hosts anyway.
 */
export function normalizeCandidateUrl(
  candidate: string,
  baseUrl: string,
  hosts: ReadonlySet<string>,
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(candidate, baseUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!hosts.has(parsed.hostname.toLowerCase())) return null;
  if (SKIPPED_SUFFIXES.test(parsed.pathname)) return null;
  parsed.protocol = 'https:';
  parsed.hash = '';
  return parsed.toString();
}

/** The hostnames that count as one site: the domain as registered plus its
 * `www.`/apex sibling — sites redirect between the two freely. */
export function siteHosts(domain: string): Set<string> {
  const host = domain.toLowerCase();
  const hosts = new Set([host]);
  if (host.startsWith('www.')) hosts.add(host.slice(4));
  else hosts.add(`www.${host}`);
  return hosts;
}

/** Split page text into the paragraphs the boilerplate ledger hashes. Short
 * fragments (menu items, button labels) are ignored — hashing them would
 * blocklist ordinary words. */
export function paragraphsForHashing(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length >= 80);
}

/** Rebuild page text without its boilerplate paragraphs — the ones whose
 * hash the ledger has seen on enough other pages of the same domain. Only
 * paragraphs long enough to be hashed are ever dropped. */
export function stripBoilerplate(
  text: string,
  boilerplate: ReadonlySet<string>,
  hashParagraph: (paragraph: string) => string,
): string {
  if (boilerplate.size === 0) return text;
  return text
    .split(/\n{2,}/)
    .filter((paragraph) => {
      const trimmed = paragraph.trim();
      if (trimmed.length < 80) return true;
      return !boilerplate.has(hashParagraph(trimmed));
    })
    .join('\n\n');
}

/** The page's meta description — `name="description"` first, Open Graph as
 * the fallback — truncated to a summary-sized length. */
export function metaDescription(html: string): string | null {
  const patterns = [
    /<meta[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["']/i,
    /<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["']/i,
    /<meta[^>]*property\s*=\s*["']og:description["'][^>]*content\s*=\s*["']([^"']*)["']/i,
    /<meta[^>]*content\s*=\s*["']([^"']*)["'][^>]*property\s*=\s*["']og:description["']/i,
  ];
  for (const pattern of patterns) {
    const value = (pattern.exec(html)?.[1] ?? '').trim();
    if (value.length > 0) return value.slice(0, 500);
  }
  return null;
}
