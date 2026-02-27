// Discriminated union type for crawler operations
export type CrawlerActionParams =
  | {
      operation: 'discover_urls';
      url?: string;
      domain?: string;
      maxPages?: number;
      maxUrls?: number;
      offset?: number;
      pattern?: string;
      query?: string;
      timeout?: number;
    }
  | {
      operation: 'fetch_urls';
      urls: string[];
      wordCountThreshold?: number;
      timeout?: number;
    }
  | {
      operation: 'query_urls';
      domain: string;
      offset?: number;
      limit?: number;
      status?: string;
      timeout?: number;
    };

// Raw response from crawler service
export interface DiscoverUrlsRawData {
  success: boolean;
  domain: string;
  urls_discovered: number;
  total_urls: number;
  urls: Array<{
    url: string;
    status: string;
    lastmod: string | null;
  }>;
  is_complete: boolean;
  offset: number;
}

// Simplified result returned by action (only URL strings to avoid memory issues)
export interface DiscoverUrlsData {
  success: boolean;
  domain: string;
  urls_discovered: number;
  total_urls: number;
  urls: string[];
  is_complete: boolean;
  offset: number;
}

export interface FetchUrlsData {
  success: boolean;
  urls_requested: number;
  urls_fetched: number;
  pages: Array<{
    url: string;
    title?: string;
    content: string;
    word_count: number;
    metadata?: Record<string, unknown>;
    structured_data?: Record<string, unknown>;
  }>;
  failed: Array<{ url: string; status_code: number | null; error: string }>;
}

// Response from GET /api/v1/websites/urls?url=...
export interface QueryUrlsRawData {
  url: string;
  urls: Array<{
    url: string;
    content_hash: string | null;
    status: string;
    last_crawled_at: number | null;
  }>;
  total: number;
  offset: number;
  has_more: boolean;
}

export interface QueryUrlsResult {
  url: string;
  urls: Array<{
    url: string;
    contentHash: string | null;
    status: string;
  }>;
  total: number;
  offset: number;
  has_more: boolean;
}

// Actions should return data directly (not wrapped in { data: ... })
// because execute_action_node wraps the result in output: { type: 'action', data: result }
export type DiscoverUrlsResult = DiscoverUrlsData;

export type FetchUrlsResult = FetchUrlsData;
