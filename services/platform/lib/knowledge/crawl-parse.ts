/**
 * The pure half of the crawler: parsing robots.txt, sitemaps, and page links,
 * and deciding which URLs belong to a scan.
 *
 * Everything here is deterministic string work — no fetching, no SQL — so the
 * crawl engine's judgment calls (what counts as the same site, what a robots
 * rule blocks, which links survive) are pinned by fast tests instead of being
 * exercised only against the live web.
 */

import { decodeHtmlEntities } from './html-to-text';

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

/** `<loc>` entries of a sitemap or sitemap-index document. Values are
 * entity-decoded — XML requires `&` in a URL to be written `&amp;`, and
 * fetching the raw text 404s on query-string sitemaps (TYPO3 et al.).
 * CDATA content is literal by spec and passes through undecoded. */
export function parseSitemapLocs(xml: string): string[] {
  const locs: string[] = [];
  for (const match of xml.matchAll(/<loc[^>]*>([\s\S]*?)<\/loc>/gi)) {
    const raw = (match[1] ?? '').trim();
    const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    const value = raw.includes('<![CDATA[')
      ? unwrapped
      : decodeHtmlEntities(unwrapped);
    if (value.length > 0) locs.push(value);
  }
  return locs;
}

/** True for a sitemap INDEX document (its locs are more sitemaps). */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/** `href` targets of a page's anchors, entity-decoded — attribute values
 * are entity-encoded by spec, so `?a=1&amp;b=2` in the markup means
 * `?a=1&b=2` to the browser and must mean the same to the crawler. */
export function extractLinks(html: string): string[] {
  const links: string[] = [];
  for (const match of html.matchAll(
    /<a\s[^>]*href\s*=\s*("([^"]*)"|'([^']*)')/gi,
  )) {
    const href = decodeHtmlEntities((match[2] ?? match[3] ?? '').trim());
    if (href.length > 0) links.push(href);
  }
  return links;
}

/** File suffixes the crawler never fetches: assets, media, feeds, archives,
 * and the legacy Office formats the extraction router has no reader for.
 * Modern document formats (pdf/docx/xlsx/pptx/odt) are admitted — the fetch
 * loop routes them through the extraction router like any other page. */
const SKIPPED_SUFFIXES =
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|mjs|json|xml|rss|atom|zip|gz|tar|mp[34]|webm|mov|avi|woff2?|ttf|eot|doc|xls|ppt)$/i;

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

/** Where the fetch loop routes a response, decided by its `Content-Type`
 * alone — an explicit whitelist, never a heuristic. `document` carries the
 * canonical extension the extraction router keys on (the server's declared
 * type wins over whatever the URL path claims). Types the crawl lane cannot
 * turn into text — images (vision-dependent), feeds, binaries — are `skip`:
 * the scan remembers it looked and stores nothing, exactly as before. */
export type CrawlDispatch =
  | { readonly kind: 'html' }
  | { readonly kind: 'text' }
  | { readonly kind: 'document'; readonly extension: string }
  | { readonly kind: 'skip' };

const DOCUMENT_MIME_EXTENSIONS: ReadonlyMap<string, string> = new Map([
  ['application/pdf', '.pdf'],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.docx',
  ],
  [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xlsx',
  ],
  [
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pptx',
  ],
  ['application/vnd.oasis.opendocument.text', '.odt'],
]);

export function classifyContentType(contentType: string): CrawlDispatch {
  const mime = (contentType.split(';')[0] ?? '').trim().toLowerCase();
  // No Content-Type header: treat as a text page, the pre-dispatch behavior.
  if (mime === '') return { kind: 'html' };
  if (mime === 'text/html' || mime === 'application/xhtml+xml') {
    return { kind: 'html' };
  }
  if (mime === 'text/plain' || mime === 'text/markdown') {
    return { kind: 'text' };
  }
  const extension = DOCUMENT_MIME_EXTENSIONS.get(mime);
  if (extension) return { kind: 'document', extension };
  return { kind: 'skip' };
}

/** A display/router filename for a document URL: the decoded basename of its
 * path with the mime-derived extension forced on — the extraction router
 * routes by extension, so the declared type must win over the path's. */
export function documentNameForUrl(url: string, extension: string): string {
  let basename = '';
  try {
    const segments = new URL(url).pathname.split('/');
    basename = segments.findLast((segment) => segment.length > 0) ?? '';
    try {
      basename = decodeURIComponent(basename);
    } catch {
      // Keep the raw segment; a bad escape sequence is display noise, not
      // an error worth failing the page over.
    }
  } catch {
    basename = '';
  }
  if (basename === '') basename = 'document';
  const lower = basename.toLowerCase();
  if (lower.endsWith(extension)) return basename;
  return `${basename}${extension}`;
}

/**
 * Normalize an operator-listed URL: the same scheme/host/fragment rules as
 * discovery, but WITHOUT the asset-suffix filter — an explicit list entry is
 * fetched even when discovery would never admit its type (the fetch loop's
 * content-type dispatch decides what becomes text).
 */
export function normalizeListedUrl(
  candidate: string,
  hosts: ReadonlySet<string>,
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(candidate.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (!hosts.has(parsed.hostname.toLowerCase())) return null;
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
