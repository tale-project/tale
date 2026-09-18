/**
 * The pure half of the crawler: parsing robots.txt, sitemaps, and page links,
 * and deciding which URLs belong to a scan.
 *
 * Everything here is deterministic string work — no fetching, no SQL — so the
 * crawl engine's judgment calls (what counts as the same site, what a robots
 * rule blocks, which links survive) are pinned by fast tests instead of being
 * exercised only against the live web.
 */

import { stripRuntimeLocations } from '../net/error-message-hygiene';
import { decodeHtmlEntities } from './html-to-text';

/**
 * The robots.txt rules that bind THIS crawler — the group that names its
 * product token, else the `*` group (RFC 9309 §2.2.1): its `Allow` and
 * `Disallow` rules and its `Crawl-delay`, as the scan persists them on the
 * website row and every link of the scan judges by them.
 */
export interface RobotsPolicy {
  readonly allow: readonly string[];
  readonly disallow: readonly string[];
  /** The group's `Crawl-delay`, in milliseconds; `0` when it sets none.
   * Capped at {@link MAX_CRAWL_DELAY_MS}. */
  readonly crawlDelayMs: number;
}

/** What robots.txt tells this crawler: the policy that binds it, and the
 * sitemap locations the file advertises (group-independent). */
export interface RobotsRules extends RobotsPolicy {
  readonly sitemaps: readonly string[];
}

/** No rules — a site without a robots.txt, or a URL list (its rows are the
 * operator's instruction). */
export const EMPTY_ROBOTS_POLICY: RobotsPolicy = {
  allow: [],
  disallow: [],
  crawlDelayMs: 0,
};

/** RFC 9309 §2.5 asks a crawler to parse at least 500 KiB; this one reads
 * this much and treats the rest as absent. */
export const ROBOTS_TXT_MAX_BYTES = 256 * 1024;

/** The longest `Crawl-delay` honoured. A scan link runs five minutes, so a
 * longer delay would fetch a handful of pages per link; a site that asks
 * for more gets this, and the documentation says so. */
export const MAX_CRAWL_DELAY_MS = 60_000;

interface RobotsGroup {
  readonly agents: string[];
  readonly allow: string[];
  readonly disallow: string[];
  crawlDelayMs: number | null;
}

/**
 * Parse robots.txt for the crawler named `productToken` (RFC 9309 §2.2.1,
 * case-insensitive): every group whose `User-agent` lines name the token
 * binds; when none does, every `*` group binds; when neither exists,
 * nothing does. Groups that bind are merged. `Sitemap` lines are the
 * file's, not a group's. A rule ahead of the first `User-agent` line binds
 * nobody. `Crawl-delay` (not in the RFC, but what Bing and Yandex honour)
 * is the group's first parsable value, in seconds, capped.
 *
 * The `*` group used to be the only one read, so a site that followed the
 * documentation and addressed `TaleBot` by name to refuse or throttle it
 * was crawled under the rules it wrote for everyone else (2026-09-18
 * evaluation, J6-4).
 */
export function parseRobots(text: string, productToken: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  // True while the last line read was a `User-agent` line: another one
  // joins the group; a rule closes the agent list, so a later `User-agent`
  // line starts a new group.
  let agentsOpen = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line.length === 0) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (field === 'sitemap') {
      if (value.length > 0) sitemaps.push(value);
      continue;
    }
    if (field === 'user-agent') {
      if (current === null || !agentsOpen) {
        current = { agents: [], allow: [], disallow: [], crawlDelayMs: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      agentsOpen = true;
      continue;
    }
    if (current === null) continue;
    agentsOpen = false;
    if (field === 'disallow' && value.length > 0) {
      current.disallow.push(value);
    } else if (field === 'allow' && value.length > 0) {
      current.allow.push(value);
    } else if (field === 'crawl-delay' && current.crawlDelayMs === null) {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) {
        current.crawlDelayMs = Math.min(
          Math.round(seconds * 1000),
          MAX_CRAWL_DELAY_MS,
        );
      }
    }
  }
  const token = productToken.toLowerCase();
  const named = groups.filter((group) => group.agents.includes(token));
  const bound =
    named.length > 0
      ? named
      : groups.filter((group) => group.agents.includes('*'));
  return {
    allow: bound.flatMap((group) => group.allow),
    disallow: bound.flatMap((group) => group.disallow),
    crawlDelayMs: bound.reduce(
      (delay, group) => Math.max(delay, group.crawlDelayMs ?? 0),
      0,
    ),
    sitemaps,
  };
}

/**
 * The policy as the website row stores it (`robots_disallow`, JSONB): the
 * object `{disallow, allow, crawlDelayMs}`; rows written before `Allow`
 * and `Crawl-delay` were read hold the bare `Disallow` array, and anything
 * else reads as no rules.
 */
export function robotsPolicyFromStored(value: unknown): RobotsPolicy {
  const strings = (list: unknown): readonly string[] =>
    Array.isArray(list)
      ? list.filter((rule): rule is string => typeof rule === 'string')
      : [];
  if (Array.isArray(value)) {
    return { allow: [], disallow: strings(value), crawlDelayMs: 0 };
  }
  if (value === null || typeof value !== 'object') return EMPTY_ROBOTS_POLICY;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowed to a non-null, non-array object above
  const stored = value as Record<string, unknown>;
  const delay = stored.crawlDelayMs;
  return {
    allow: strings(stored.allow),
    disallow: strings(stored.disallow),
    crawlDelayMs:
      typeof delay === 'number' && Number.isFinite(delay) && delay > 0
        ? Math.min(Math.round(delay), MAX_CRAWL_DELAY_MS)
        : 0,
  };
}

/** The stored form of a policy — what `robotsPolicyFromStored` reads back. */
export function robotsPolicyToStored(
  policy: RobotsPolicy,
): Record<string, unknown> {
  return {
    disallow: [...policy.disallow],
    allow: [...policy.allow],
    crawlDelayMs: policy.crawlDelayMs,
  };
}

/** RFC 9309 §2.2.3: `*` matches any run of characters, a trailing `$`
 * anchors the end of the path; everything else is literal. A rule that
 * uses neither is a plain prefix. */
function ruleMatches(pathname: string, rule: string): boolean {
  if (!rule.includes('*') && !rule.endsWith('$')) {
    return pathname.startsWith(rule);
  }
  const anchored = rule.endsWith('$');
  const pattern = (anchored ? rule.slice(0, -1) : rule)
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(pathname);
}

/** The length of the longest rule that matches, or null when none does —
 * the RFC's measure of specificity ("the most octets"). */
function longestMatch(
  pathname: string,
  rules: readonly string[],
): number | null {
  let longest: number | null = null;
  for (const rule of rules) {
    if (!ruleMatches(pathname, rule)) continue;
    if (longest === null || rule.length > longest) longest = rule.length;
  }
  return longest;
}

/**
 * Whether the policy forbids fetching this path (RFC 9309 §2.2.2): the
 * most specific matching rule decides — the longest one — and a tie between
 * an `Allow` and a `Disallow` goes to the `Allow`. Until here `Allow` was
 * not read and a `$` anchor was matched as a literal, so `Disallow: /*.pdf$`
 * failed open and `Allow: /public/` under `Disallow: /` admitted nothing.
 */
export function isDisallowed(pathname: string, policy: RobotsPolicy): boolean {
  const disallowed = longestMatch(pathname, policy.disallow);
  if (disallowed === null) return false;
  const allowed = longestMatch(pathname, policy.allow);
  return allowed === null || allowed < disallowed;
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
  // A registration names a hostname, never a port: a same-host link to a
  // non-standard port (`info.cern.ch:8001/…`, a WAIS gateway) is another
  // service, not a page of the site — it used to pass the host test, be
  // upgraded to https and dialled on that port, hundreds of dead fetches
  // per scan (2026-09-14 evaluation, g4-6).
  if (parsed.port !== '') return null;
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
  // Same rule as a discovered link: the site is a hostname, a port names
  // another service.
  if (parsed.port !== '') return null;
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

/** Whether an `X-Robots-Tag` field forbids indexing: `noindex` or `none`
 * among its comma-separated directives, unprefixed or under the `*:` or any
 * agent prefix — a site's wish about every crawler applies to this one
 * (2026-09-14 evaluation, g4-10). */
export function robotsHeaderForbidsIndexing(value: string | null): boolean {
  if (value === null) return false;
  return value
    .split(',')
    .map((directive) => directive.trim().toLowerCase())
    .map((directive) =>
      directive.includes(':')
        ? directive.slice(directive.indexOf(':') + 1).trim()
        : directive,
    )
    .some((directive) => directive === 'noindex' || directive === 'none');
}

/** True when the robots policy blocks this URL — judged on the path and
 * the query together, the string robots.txt rules are written against
 * (`Disallow: /search?q=` is a rule on the query); a URL that does not
 * parse is nobody's to block. */
export function isUrlDisallowed(url: string, policy: RobotsPolicy): boolean {
  if (policy.disallow.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return isDisallowed(parsed.pathname + parsed.search, policy);
}

/**
 * The same-site links of a page a scan may FOLLOW: the host, port and
 * asset rules of {@link normalizeCandidateUrl}, then the robots rules —
 * de-duplicated, in page order. The one seam every admission path shares.
 * The discovery walk applied the rules and the rendered-page admission did
 * not, so every disallowed link a rendered page carried joined the frontier,
 * was fetched, indexed and served (2026-09-14 evaluation, h5).
 */
export function discoverableLinks(
  html: string,
  baseUrl: string,
  hosts: ReadonlySet<string>,
  policy: RobotsPolicy,
): string[] {
  const links = new Set<string>();
  for (const href of extractLinks(html)) {
    const normalized = normalizeCandidateUrl(href, baseUrl, hosts);
    if (!normalized) continue;
    if (isUrlDisallowed(normalized, policy)) continue;
    links.add(normalized);
  }
  return [...links];
}

/** The `<meta name="robots">` content that forbids indexing, or null:
 * `noindex` or `none` among its comma-separated directives, whichever
 * attribute order and quoting the page uses. A meta aimed at one named
 * agent (`googlebot`) is not this crawler's to honour — as a robots.txt
 * group that names another crawler is not ({@link parseRobots}). The
 * header form (`X-Robots-Tag`) was honoured while
 * the tag, the form most sites use, was not (2026-09-14 evaluation, h5). */
export function robotsMetaNoindexDirective(html: string): string | null {
  for (const match of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = match[0];
    const name = /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    const nameValue = (name?.[1] ?? name?.[2] ?? name?.[3] ?? '')
      .trim()
      .toLowerCase();
    if (nameValue !== 'robots') continue;
    const content = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(
      tag,
    );
    const directives = decodeHtmlEntities(
      (content?.[1] ?? content?.[2] ?? content?.[3] ?? '').trim(),
    );
    const forbids = directives
      .split(',')
      .map((directive) => directive.trim().toLowerCase())
      .some((directive) => directive === 'noindex' || directive === 'none');
    if (forbids) return directives;
  }
  return null;
}

/** What a page's `lastError` may carry: the first line of the cause with
 * the toolchain's file-and-line fragments removed — a customer-facing
 * field, never a Playwright call log or an OpenSSL source path
 * (2026-09-14 evaluation, h5). Secrets are the writer's redaction. */
export function publicPageError(message: string): string {
  const firstLine = message.split(/\r?\n/, 1)[0] ?? '';
  return stripRuntimeLocations(firstLine);
}

/** How a rendered page's failure reads on its row: the browser's own load
 * budget expiring is the `timeout` the contract names, not a generic render
 * failure, and the message names the budget instead of the call log. */
export function classifyRenderReason(reason: string): {
  readonly kind: 'timeout' | 'render_failed';
  readonly message: string;
} {
  const timeout = /^page\.goto: Timeout (\d+)ms exceeded/i.exec(reason);
  if (timeout) {
    const seconds = Math.round(Number(timeout[1]) / 1000);
    return {
      kind: 'timeout',
      message: `The browser could not load the page within ${seconds} seconds`,
    };
  }
  return { kind: 'render_failed', message: publicPageError(reason) };
}
