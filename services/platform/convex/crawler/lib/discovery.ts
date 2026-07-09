'use node';

/**
 * URL discovery + single-page crawl for the crawler corpus.
 *
 * Port of the discovery/crawl portions of
 * `services/crawler/app/services/crawler_service.py`
 * (`discover_urls` + `_discover_urls_bfs` + `crawl_urls` / `crawl_single_url`).
 *
 * The Python service used crawl4ai (headless Chromium) + ultimate-sitemap-parser,
 * neither of which has an npm package. This re-implements the same behaviour:
 *
 *   - SITEMAP discovery REPLACES `usp.tree.sitemap_tree_for_homepage`: it reads
 *     `robots.txt` `Sitemap:` directives plus the conventional
 *     `https://{domain}/sitemap.xml`, parses each with `fast-xml-parser`,
 *     recurses into `<sitemapindex>` entries (depth-limited to 2), and collects
 *     every `<urlset><url><loc>`. fnmatch-style `pattern` filtering is applied.
 *
 *   - BFS FALLBACK REPLACES crawl4ai's `BFSDeepCrawlStrategy`: when the sitemap
 *     yields fewer than `_BFS_FALLBACK_THRESHOLD` (10) URLs, it BFS-crawls from
 *     the homepage up to `max_depth=2`, extracting same-registrable-domain
 *     `<a href>` links via jsdom and normalizing them to absolute URLs.
 *
 * Page fetch + JS rendering is delegated to `fetchRenderedHtml` (the documented
 * sandbox-runtime seam). By DEFAULT that is a plain HTTP GET — correct for
 * static / server-rendered pages (the dominant case for sitemapped docs sites),
 * but JS-rendered link discovery and JS-rendered content depend on the render
 * mode being enabled (`CRAWLER_RENDER_VIA_SANDBOX=1`, not yet wired end-to-end).
 */

import { XMLParser } from 'fast-xml-parser';

import { logger } from '../../lib/knowledge/logger';
import {
  htmlToFitMarkdown,
  htmlToRawMarkdown,
} from '../helpers/content_filter';
import { fetchRenderedHtml } from '../helpers/fetch_rendered_html';
import { parseHtml } from '../helpers/parse_html';
import {
  extractStructuredDataFromHtml,
  extractTitleFromHtml,
  type StructuredData,
} from '../helpers/structured_data';
import type { SandboxRenderContext } from './sandbox_render';

const _BFS_FALLBACK_THRESHOLD = 10;
const _BFS_FALLBACK_MAX_PAGES = 1000;
const _SITEMAP_INDEX_MAX_DEPTH = 2;
const _BFS_MAX_DEPTH = 2;

export interface DiscoveredUrl {
  url: string;
}

export interface DiscoverUrlsOptions {
  maxUrls?: number;
  pattern?: string | null;
  timeoutMs?: number;
  /**
   * Sandbox render context. When present AND `CRAWLER_RENDER_VIA_SANDBOX=1`,
   * sitemap/BFS/page fetches are JS-rendered via the spawner; otherwise plain
   * fetch. Threaded down to every `fetchRenderedHtml` call.
   */
  renderContext?: SandboxRenderContext;
}

/** Translate an fnmatch-style glob into a RegExp (`*`→`.*`, `?`→`.`). */
function fnmatchToRegExp(pattern: string): RegExp {
  let out = '';
  for (const ch of pattern) {
    if (ch === '*') {
      out += '.*';
    } else if (ch === '?') {
      out += '.';
    } else {
      // Escape regex metacharacters.
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

function matchesPattern(
  url: string,
  pattern: string | null | undefined,
): boolean {
  if (!pattern) {
    return true;
  }
  return fnmatchToRegExp(pattern).test(url);
}

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  // Normalize repeated elements to arrays where helpful; we defensively coerce
  // below so single-vs-array shapes from fast-xml-parser are both handled.
});

/** Coerce a fast-xml-parser node that may be a single object or an array. */
function asArray(value: unknown): unknown[] {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/**
 * Read a property off an `unknown` value, returning `undefined` when the value
 * is not a plain object or the key is absent. Keeps the fast-xml-parser output
 * behind a guarded accessor instead of unsafe assertions.
 */
function propOf(value: unknown, key: string): unknown {
  if (value !== null && typeof value === 'object') {
    return Reflect.get(value, key);
  }
  return undefined;
}

/** Extract `<loc>` text from a `<url>` or `<sitemap>` node. */
function locOf(node: unknown): string | null {
  if (node == null) {
    return null;
  }
  if (typeof node === 'string') {
    return node.trim() || null;
  }
  if (typeof node === 'object' && 'loc' in node) {
    const loc = (node as { loc?: unknown }).loc;
    if (typeof loc === 'string') {
      return loc.trim() || null;
    }
    if (typeof loc === 'number') {
      return String(loc);
    }
  }
  return null;
}

/**
 * Fetch and parse one sitemap URL. Recurses into `<sitemapindex>` entries
 * (depth-limited) and collects every `<urlset>` `<loc>`.
 */
async function parseSitemap(
  sitemapUrl: string,
  depth: number,
  seen: Set<string>,
  collected: Set<string>,
  timeoutMs: number,
  renderContext: SandboxRenderContext | undefined,
): Promise<void> {
  if (depth > _SITEMAP_INDEX_MAX_DEPTH || seen.has(sitemapUrl)) {
    return;
  }
  seen.add(sitemapUrl);

  let xml: string;
  try {
    const res = await fetchRenderedHtml(sitemapUrl, {
      timeoutMs,
      renderContext,
    });
    if (res.status >= 400) {
      logger.debug(`Sitemap ${sitemapUrl} returned HTTP ${res.status}`);
      return;
    }
    xml = res.html;
  } catch (err) {
    logger.debug(
      `Failed to fetch sitemap ${sitemapUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  let parsed: unknown;
  try {
    // `XMLParser.parse` is typed `any`; capture as `unknown` and read
    // properties through `propOf` (a guarded accessor) so no unsafe
    // assertion crosses the boundary.
    parsed = xmlParser.parse(xml);
  } catch (err) {
    logger.debug(
      `Failed to parse sitemap XML ${sitemapUrl}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Sitemap index: <sitemapindex><sitemap><loc>...</loc></sitemap></sitemapindex>
  const sitemapIndex = propOf(parsed, 'sitemapindex');
  for (const entry of asArray(propOf(sitemapIndex, 'sitemap'))) {
    const loc = locOf(entry);
    if (loc) {
      await parseSitemap(
        loc,
        depth + 1,
        seen,
        collected,
        timeoutMs,
        renderContext,
      );
    }
  }

  // URL set: <urlset><url><loc>...</loc></url></urlset>
  const urlset = propOf(parsed, 'urlset');
  for (const entry of asArray(propOf(urlset, 'url'))) {
    const loc = locOf(entry);
    if (loc) {
      collected.add(loc);
    }
  }
}

/** Read `robots.txt` and return the `Sitemap:` directive URLs. */
async function sitemapsFromRobots(
  domain: string,
  timeoutMs: number,
  renderContext: SandboxRenderContext | undefined,
): Promise<string[]> {
  const robotsUrl = `https://${domain}/robots.txt`;
  try {
    const res = await fetchRenderedHtml(robotsUrl, {
      timeoutMs,
      renderContext,
    });
    if (res.status >= 400) {
      return [];
    }
    const out: string[] = [];
    for (const line of res.html.split('\n')) {
      const trimmed = line.trim();
      const lower = trimmed.toLowerCase();
      if (lower.startsWith('sitemap:')) {
        const value = trimmed.slice('sitemap:'.length).trim();
        if (value) {
          out.push(value);
        }
      }
    }
    return out;
  } catch (err) {
    logger.debug(
      `Failed to fetch robots.txt for ${domain}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

/** Derive the registrable-ish domain comparison key (host without leading www). */
function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

/**
 * BFS link-crawl fallback. Replaces crawl4ai's BFSDeepCrawlStrategy: starts at
 * the homepage, follows same-registrable-domain `<a href>` links breadth-first
 * up to `max_depth=2` and `maxPages`, deduping.
 */
async function discoverUrlsBfs(
  domain: string,
  maxUrls: number,
  pattern: string | null | undefined,
  timeoutMs: number,
  renderContext: SandboxRenderContext | undefined,
): Promise<DiscoveredUrl[]> {
  const maxPages = maxUrls > 0 ? maxUrls : _BFS_FALLBACK_MAX_PAGES;
  const homepage = `https://${domain}/`;
  const targetHost = normalizeHost(domain);
  logger.info(
    `Starting BFS crawl for ${domain} (max_depth=${_BFS_MAX_DEPTH}, max_pages=${maxPages})`,
  );

  const visited = new Set<string>();
  const discovered = new Set<string>();
  // Queue of [url, depth].
  let frontier: [string, number][] = [[homepage, 0]];

  while (frontier.length > 0 && discovered.size < maxPages) {
    const nextFrontier: [string, number][] = [];
    for (const [url, depth] of frontier) {
      if (discovered.size >= maxPages) {
        break;
      }
      if (visited.has(url)) {
        continue;
      }
      visited.add(url);

      let html: string;
      try {
        const res = await fetchRenderedHtml(url, { timeoutMs, renderContext });
        if (res.status >= 400) {
          continue;
        }
        html = res.html;
      } catch (err) {
        logger.debug(
          `BFS fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      // Record this page (same-domain, pattern-matched).
      if (matchesPattern(url, pattern)) {
        discovered.add(url);
      }

      if (depth >= _BFS_MAX_DEPTH) {
        continue;
      }

      // Extract same-domain links.
      let links: string[] = [];
      try {
        const { document } = parseHtml(html).window;
        const anchors = Array.from(document.querySelectorAll('a[href]'));
        for (const a of anchors) {
          const href = a.getAttribute('href');
          if (!href) {
            continue;
          }
          let absolute: URL;
          try {
            absolute = new URL(href, url);
          } catch {
            continue;
          }
          if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:') {
            continue;
          }
          if (normalizeHost(absolute.hostname) !== targetHost) {
            continue;
          }
          // Drop fragments so #-anchors don't explode the frontier.
          absolute.hash = '';
          links.push(absolute.toString());
        }
      } catch (err) {
        logger.debug(
          `BFS link extraction failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
        );
        links = [];
      }

      for (const link of links) {
        if (!visited.has(link)) {
          nextFrontier.push([link, depth + 1]);
        }
      }
    }
    frontier = nextFrontier;
  }

  return [...discovered].map((url) => ({ url }));
}

/**
 * Discover all URLs on a website via sitemap parsing, with a BFS fallback.
 *
 * @param domain e.g. "docs.example.com"
 * @param options.maxUrls maximum URLs to discover (-1 / 0 for unlimited)
 * @param options.pattern optional fnmatch-style URL filter (e.g. "*\/docs/*")
 * @param options.timeoutMs per-request timeout
 */
export async function discoverUrls(
  domain: string,
  options: DiscoverUrlsOptions = {},
): Promise<DiscoveredUrl[]> {
  const maxUrls = options.maxUrls ?? 100;
  const pattern = options.pattern ?? null;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const renderContext = options.renderContext;

  logger.info(`Discovering URLs from ${domain} via sitemap...`);

  // 1. SITEMAP: gather sitemap URLs from robots.txt + the conventional path.
  const seen = new Set<string>();
  const collected = new Set<string>();
  const sitemapUrls = new Set<string>([
    ...(await sitemapsFromRobots(domain, timeoutMs, renderContext)),
    `https://${domain}/sitemap.xml`,
  ]);
  for (const sitemapUrl of sitemapUrls) {
    await parseSitemap(
      sitemapUrl,
      0,
      seen,
      collected,
      timeoutMs,
      renderContext,
    );
  }

  // Apply pattern filter + maxUrls cap (in iteration order, sitemap-first).
  const urls: DiscoveredUrl[] = [];
  const urlSet = new Set<string>();
  for (const loc of collected) {
    if (maxUrls > 0 && urls.length >= maxUrls) {
      break;
    }
    if (!matchesPattern(loc, pattern)) {
      continue;
    }
    if (!urlSet.has(loc)) {
      urlSet.add(loc);
      urls.push({ url: loc });
    }
  }

  logger.info(`Discovered ${urls.length} URLs from ${domain} via sitemap`);

  // 2. BFS FALLBACK when the sitemap is unavailable or incomplete.
  if (urls.length < _BFS_FALLBACK_THRESHOLD) {
    logger.warn(
      `Sitemap found only ${urls.length} URLs for ${domain}, falling back to BFS crawl`,
    );
    let bfsUrls: DiscoveredUrl[] = [];
    try {
      bfsUrls = await discoverUrlsBfs(
        domain,
        maxUrls,
        pattern,
        timeoutMs,
        renderContext,
      );
    } catch (err) {
      logger.error(
        `BFS fallback failed for ${domain}: ${err instanceof Error ? err.message : String(err)}`,
      );
      bfsUrls = [];
    }
    logger.info(
      `BFS fallback discovered ${bfsUrls.length} URLs from ${domain}`,
    );
    // Merge sitemap + BFS uniquely (sitemap first).
    for (const u of bfsUrls) {
      if (maxUrls > 0 && urls.length >= maxUrls) {
        break;
      }
      if (!urlSet.has(u.url)) {
        urlSet.add(u.url);
        urls.push(u);
      }
    }
  }

  return urls;
}

export interface CrawledPage {
  url: string;
  status_code: number;
  title: string | null;
  content: string;
  word_count: number;
  metadata: StructuredData;
  structured_data: StructuredData;
}

export interface CrawlFailure {
  url: string;
  status_code: number;
  content: null;
}

/**
 * Crawl a single URL and extract its content.
 *
 * Ports `crawl_single_url` / the `crawl_urls` per-page processing: fetch +
 * render the HTML, prefer density-filtered fit markdown over raw markdown,
 * extract structured data + title. Returns `{ content: null }` on HTTP >= 400.
 *
 * NOTE: the Python source's `metadata` was crawl4ai's page metadata dict; here
 * the closest faithful analogue is the extracted structured-data object (the
 * helper has no separate page-metadata extractor), so `metadata` mirrors
 * `structured_data`.
 */
export async function crawlUrl(
  url: string,
  options: { timeoutMs?: number; renderContext?: SandboxRenderContext } = {},
): Promise<CrawledPage | CrawlFailure> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const res = await fetchRenderedHtml(url, {
    timeoutMs,
    renderContext: options.renderContext,
  });

  if (res.status >= 400) {
    logger.warn(`HTTP error for ${res.url}: ${res.status}`);
    return { url: res.url, status_code: res.status, content: null };
  }

  const html = res.html;
  const markdown = htmlToFitMarkdown(html) || htmlToRawMarkdown(html);
  const structured = extractStructuredDataFromHtml(html);
  const title = extractTitleFromHtml(html);
  const wordCount = markdown.split(/\s+/).filter(Boolean).length;

  return {
    url: res.url,
    status_code: res.status,
    title,
    content: markdown,
    word_count: wordCount,
    metadata: structured,
    structured_data: structured,
  };
}
