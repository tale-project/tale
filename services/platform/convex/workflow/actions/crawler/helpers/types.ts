// Discriminated union type for crawler operations
export type CrawlerActionParams =
  | {
      operation: 'discover_urls';
      url?: string;
      domain?: string;
      maxPages?: number;
      maxUrls?: number;
      pattern?: string;
      query?: string;
      timeout?: number;
    }
  | {
      operation: 'fetch_urls';
      urls: string[];
      wordCountThreshold?: number;
      timeout?: number;
    };

export interface DiscoverUrlsData {
  success: boolean;
  domain: string;
  urls_discovered: number;
  urls: Array<{
    url: string;
    status: string;
    metadata?: Record<string, unknown>;
  }>;
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
}

// Actions should return data directly (not wrapped in { data: ... })
// because execute_action_node wraps the result in output: { type: 'action', data: result }
export type DiscoverUrlsResult = DiscoverUrlsData;

export type FetchUrlsResult = FetchUrlsData;

