/**
 * Type definitions for website operations
 */

export type WebsiteStatus =
  | 'idle'
  | 'scanning'
  | 'active'
  | 'error'
  | 'deleting';

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

export interface CrawlerPage {
  url: string;
  title: string | null;
  word_count: number;
  status: string;
  content_hash: string | null;
  last_crawled_at: string | null;
  discovered_at: string | null;
  chunks_count: number;
  indexed: boolean;
}

export interface CrawlerWebsiteInfo {
  domain: string;
  kind: WebsiteKind;
  title: string | null;
  description: string | null;
  page_count: number;
  crawled_count: number;
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
