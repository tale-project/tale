/**
 * Type definitions for website operations
 */

import { SAFE_FETCH_ERROR_KINDS } from '../../../lib/net/safe-fetch-kinds';

/**
 * The SCAN's lifecycle, not the content's health — declared once so the
 * REST filter refuses a value outside it and the OpenAPI enum publishes it
 * (the filter used to answer an empty page for `?status=bogus`, and the
 * spec declared the field a bare string — 2026-09-14 evaluation, g4-7):
 * `scanning` in flight — a registered site starts here; `active` the last
 * scan finished and stored at least one page; `error` the last scan failed
 * or stored no page (`metadata.lastSyncError` says why); `deleting` mid
 * removal. `idle` was declared and never observable — a site is `scanning`
 * from registration and `active`/`error` between scans (2026-09-14
 * evaluation, h5).
 */
export const WEBSITE_STATUS_VALUES = [
  'scanning',
  'active',
  'error',
  'deleting',
] as const;

export type WebsiteStatus = (typeof WEBSITE_STATUS_VALUES)[number];

/** What a websites row IS: a crawled site (pages discovered via
 * robots/sitemaps/links) or a curated list of URLs fetched verbatim. Absent
 * on rows that predate the distinction — read absent as 'site'. */
export type WebsiteKind = 'site' | 'list';

/**
 * The allowed scan-interval cadences. This is the single source of truth for
 * every write path (REST, the agent write tool, and the website routes) —
 * `scanIntervalToSeconds` maps exactly these values, so an unrecognized value
 * would silently fall back to the 6h default and get crawled at the wrong rate.
 */
export const SCAN_INTERVAL_VALUES = [
  '60m',
  '6h',
  '12h',
  '1d',
  '5d',
  '7d',
  '30d',
] as const;

export type ScanInterval = (typeof SCAN_INTERVAL_VALUES)[number];

export function isValidScanInterval(value: unknown): value is ScanInterval {
  return (
    typeof value === 'string' &&
    (SCAN_INTERVAL_VALUES as readonly string[]).includes(value)
  );
}

export function scanIntervalToSeconds(interval: string): number {
  switch (interval) {
    case '60m':
      return 3600;
    case '6h':
      return 21600;
    case '12h':
      return 43200;
    case '1d':
      return 86400;
    case '5d':
      return 432000;
    case '7d':
      return 604800;
    case '30d':
      return 2592000;
    default:
      return 21600;
  }
}

// =============================================================================
// CRAWLER SERVICE TYPES
// =============================================================================

/**
 * Why the crawler could not store a page: the fetch client's refusal kinds
 * (a redirect into a private address, a DNS miss, a timeout, a body over the
 * cap, …) plus the crawl's own three — a non-2xx answer, a render the
 * sandboxed browser gave up on, a linked document no extractor could read.
 * Declared once: the crawler writes it, the page list answers it, the
 * OpenAPI enum publishes it.
 */
export const PAGE_FAILURE_KINDS = [
  ...SAFE_FETCH_ERROR_KINDS,
  'http_error',
  'render_failed',
  'extraction_failed',
  // The crawler LOOKED and deliberately stored nothing: a content type this
  // lane cannot turn into text (JSON, XML, an image, a binary download).
  // It used to clear the row silently, so a listed URL that would never
  // yield content was indistinguishable from one never fetched (2026-09-14
  // evaluation, g4-3).
  'unsupported_content',
  // The origin asked not to be indexed (`X-Robots-Tag: noindex`).
  'robots_noindex',
] as const;

export type PageFailureKind = (typeof PAGE_FAILURE_KINDS)[number];

export interface CrawlerPage {
  url: string;
  title: string | null;
  word_count: number;
  /** `discovered` until a fetch stores the page, `active` from then on;
   * `deleted` rows never reach a listing. */
  status: string;
  content_hash: string | null;
  last_crawled_at: string | null;
  discovered_at: string | null;
  chunks_count: number;
  indexed: boolean;
  /** Consecutive failed attempts since the last stored fetch (or the
   * operator's re-listing); 0 on a row whose last attempt stored it. */
  fail_count: number;
  /** The last failure, cleared the moment a fetch stores the page again —
   * set, they describe why the row's LAST attempt stored nothing. */
  last_error: string | null;
  last_error_kind: string | null;
  last_error_at: string | null;
}

export interface CrawlerWebsiteInfo {
  domain: string;
  kind: WebsiteKind;
  title: string | null;
  description: string | null;
  page_count: number;
  /** Pages the crawler ATTEMPTED — stored or not (`last_crawled_at` set). */
  crawled_count: number;
  /** Pages whose last attempt failed (`fail_count > 0`). */
  failed_count: number;
  status: WebsiteStatus;
  last_scanned_at: string | null;
  /** Why the last scan failed — set with status 'error', cleared on the next
   * scan start. */
  error: string | null;
}

export interface CrawlerChunk {
  chunk_index: number;
  chunk_content: string;
  // Part B Phase 1+: empty for legacy rows, populated after crawler reindex.
  // Prefer this over chunk_content for display/reassembly; chunk_content is
  // removed in Phase 5.
  core_content?: string;
}

export interface CrawlerSearchResult {
  url: string;
  title: string | null;
  chunk_content: string;
  chunk_index: number;
  score: number;
  // Part B Phase 1+: empty for legacy rows, populated after crawler reindex.
  // Adjacent-chunk hits duplicate overlap bytes when rendering from
  // chunk_content; prefer core_content once rollout completes.
  core_content?: string;
}
