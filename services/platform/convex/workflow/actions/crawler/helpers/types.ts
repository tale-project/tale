export interface CrawlerActionParams {
  operation: 'discover_urls' | 'fetch_urls';
  // For crawl_website and discover_urls
  url?: string;
  domain?: string;
  maxPages?: number;
  maxUrls?: number;
  pattern?: string;
  query?: string;
  // For fetch_urls
  urls?: string[];
  wordCountThreshold?: number;
  timeout?: number;
}

export interface DiscoverUrlsResult {
  success: boolean;
  domain: string;
  urls_discovered: number;
  urls: Array<{
    url: string;
    status: string;
    metadata?: Record<string, unknown>;
  }>;
}

export interface FetchUrlsResult {
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

