'use node';

/**
 * Internal actions for the crawl/index workflow operations.
 *
 * Maps the operations the workflow `crawler_action.ts` caller needs onto the
 * ported lib functions:
 *
 *   - indexPage     <- POST /api/v1/index/page        (services/routers/index.py)
 *   - indexWebsite  <- POST /api/v1/index/website/{domain}
 *   - discoverUrls  <- POST /api/v1/urls/discover     (operation='discover_urls')
 *   - fetchUrls     <- POST /api/v1/urls/fetch        (operation='fetch_urls')
 *
 * `fetchUrls` ports the `crawl_urls` + `update_content_hashes` flow: crawl a
 * batch of URLs, then persist their content/title/hash/metadata/structured_data
 * via the website store. Pages below `word_count_threshold` are still recorded
 * but flagged (matching the Python store-everything behaviour where the
 * threshold only filtered crawl4ai's own markdown emission).
 *
 * Return values are JSON-serializable. `returns` validators are omitted.
 */

import { v } from 'convex/values';

import { internalAction } from '../_generated/server';
import { getKnowledgePoolForOrg } from '../lib/knowledge/db/knowledge_db';
import { computeContentHash } from '../lib/knowledge/utils/hashing';
import { crawlUrl, discoverUrls as libDiscoverUrls } from './lib/discovery';
import {
  indexPage as libIndexPage,
  indexWebsite as libIndexWebsite,
} from './lib/indexing_service';
import {
  saveDiscoveredUrls,
  updateContentHashes,
  incrementFailCount,
  type ContentHashUpdate,
} from './lib/website_store';

/**
 * Index a single page (chunk + embed + store). Mirrors `POST /api/v1/index/page`.
 */
export const indexPage = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
    url: v.string(),
    title: v.optional(v.union(v.string(), v.null())),
    content: v.string(),
  },
  handler: async (_ctx, args) => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    const result = await libIndexPage(
      sql,
      args.orgSlug,
      args.domain,
      args.url,
      args.title ?? null,
      args.content,
    );
    return {
      success: result.status === 'indexed' || result.status === 'skipped',
      url: result.url,
      chunks_indexed: result.chunks_indexed,
      status: result.status,
      error: result.error ?? null,
    };
  },
});

/**
 * Re-index all pages for a website. Mirrors `POST /api/v1/index/website/{domain}`.
 */
export const indexWebsite = internalAction({
  args: {
    orgSlug: v.string(),
    domain: v.string(),
  },
  handler: async (_ctx, args) => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    const result = await libIndexWebsite(sql, args.orgSlug, args.domain);
    return {
      success: true,
      domain: result.domain,
      pages_indexed: result.pages_indexed,
      pages_skipped: result.pages_skipped,
      pages_failed: result.pages_failed,
      total_chunks: result.total_chunks,
    };
  },
});

/**
 * Discover URLs for a domain (sitemap + BFS fallback) and persist them.
 * Mirrors the `operation='discover_urls'` path: discover, then
 * `save_discovered_urls`. Returns the discovered URLs + the newly-inserted count.
 */
export const discoverUrls = internalAction({
  args: {
    // Routes the discovered URLs to the org's own knowledge pool (BYO or the
    // deployment default) — the crawler corpus is isolated per-org.
    orgSlug: v.string(),
    domain: v.string(),
    maxUrls: v.optional(v.number()),
    pattern: v.optional(v.union(v.string(), v.null())),
    timeout: v.optional(v.number()),
    // `offset` / `query` are accepted for API compatibility with the Python
    // endpoint but unused by sitemap+BFS discovery.
    offset: v.optional(v.number()),
    query: v.optional(v.union(v.string(), v.null())),
    // When provided AND `CRAWLER_RENDER_VIA_SANDBOX=1`, page fetches are
    // JS-rendered via the spawner (else plain fetch). Threaded from the
    // workflow caller which holds the org context.
    organizationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    const discovered = await libDiscoverUrls(args.domain, {
      maxUrls: args.maxUrls ?? 100,
      pattern: args.pattern ?? null,
      timeoutMs: args.timeout,
      renderContext: args.organizationId
        ? { ctx, organizationId: args.organizationId }
        : undefined,
    });
    const inserted = await saveDiscoveredUrls(sql, args.domain, discovered);
    return {
      domain: args.domain,
      urls: discovered,
      discovered: discovered.length,
      inserted,
    };
  },
});

/**
 * Crawl a batch of URLs and persist their content. Mirrors the
 * `operation='fetch_urls'` path (`crawl_urls` + `update_content_hashes`).
 *
 * Each URL is fetched + converted to markdown; successful pages are written
 * back with a fresh SHA-256 content hash, title, word count, metadata, and
 * structured data. URLs that fail (HTTP >= 400 or fetch error) have their
 * fail-count incremented.
 */
export const fetchUrls = internalAction({
  args: {
    // Routes fetched page content to the org's own knowledge pool (BYO or the
    // deployment default) — the crawler corpus is isolated per-org.
    orgSlug: v.string(),
    domain: v.string(),
    urls: v.array(v.string()),
    wordCountThreshold: v.optional(v.number()),
    timeout: v.optional(v.number()),
    // When provided AND `CRAWLER_RENDER_VIA_SANDBOX=1`, page fetches are
    // JS-rendered via the spawner (else plain fetch).
    organizationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sql = await getKnowledgePoolForOrg(args.orgSlug);
    const timeoutMs = args.timeout;
    const renderContext = args.organizationId
      ? { ctx, organizationId: args.organizationId }
      : undefined;
    const updates: ContentHashUpdate[] = [];
    const failedUrls: string[] = [];
    // Full page bodies returned to the workflow caller — the in-process port
    // returns content directly (the external service's `/api/v1/urls/fetch`
    // response shape) so `crawler_action.ts` no longer needs the HTTP service.
    const pages: {
      url: string;
      title?: string;
      content: string;
      word_count: number;
      metadata?: Record<string, unknown>;
      structured_data?: Record<string, unknown>;
    }[] = [];
    const failed: {
      url: string;
      status_code: number | null;
      error: string;
    }[] = [];

    for (const url of args.urls) {
      let page: Awaited<ReturnType<typeof crawlUrl>>;
      try {
        page = await crawlUrl(url, { timeoutMs, renderContext });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[crawler] fetch failed for ${url}: ${message}`);
        failedUrls.push(url);
        failed.push({ url, status_code: null, error: message });
        continue;
      }
      if (page.content === null) {
        failedUrls.push(page.url);
        failed.push({
          url: page.url,
          status_code: page.status_code,
          error: `HTTP ${page.status_code}`,
        });
        continue;
      }
      // The `content === null` guard above narrows `page` to `CrawledPage`
      // (the only union member with a non-null `content`).
      const ok = page;
      updates.push({
        url: ok.url,
        content_hash: computeContentHash(ok.content),
        status: 'active',
        title: ok.title,
        content: ok.content,
        word_count: ok.word_count,
        metadata: ok.metadata,
        structured_data: ok.structured_data,
      });
      pages.push({
        url: ok.url,
        ...(ok.title != null ? { title: ok.title } : {}),
        content: ok.content,
        word_count: ok.word_count,
        // `StructuredData` is an interface (optional props); copy onto a plain
        // record so it satisfies the `Record<string, unknown>` page shape the
        // workflow caller maps into `FetchUrlsResult`.
        metadata: { ...ok.metadata },
        structured_data: { ...ok.structured_data },
      });
    }

    if (updates.length > 0) {
      await updateContentHashes(sql, args.domain, updates);
    }
    if (failedUrls.length > 0) {
      await incrementFailCount(sql, args.domain, failedUrls);
    }

    return {
      success: true,
      domain: args.domain,
      urls_requested: args.urls.length,
      urls_fetched: pages.length,
      pages,
      failed,
      pages_fetched: pages.length,
      pages_failed: failed.length,
    };
  },
});
