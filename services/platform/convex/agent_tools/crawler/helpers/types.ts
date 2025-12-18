/**
 * Shared types and interfaces for web_read tool and its helpers
 */

// =============================================================================
// FETCH URL TYPES
// =============================================================================

export interface PageContent {
  url: string;
  title?: string;
  content: string;
  word_count: number;
  metadata?: Record<string, unknown>;
  structured_data?: Record<string, unknown>;
}

export interface FetchUrlsApiResponse {
  success: boolean;
  urls_requested: number;
  urls_fetched: number;
  pages: PageContent[];
}

export type WebReadFetchUrlResult = {
  operation: 'fetch_url';
  success: boolean;
  url: string;
  title?: string;
  /** Page content (markdown text extracted from page). */
  content: string;
  word_count: number;
  metadata?: Record<string, unknown>;
  /** OpenGraph and JSON-LD structured data. Use this for product pricing/variants when available. */
  structured_data?: Record<string, unknown>;
};

// =============================================================================
// WEB SEARCH TYPES
// =============================================================================

export interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  engines?: string[];
  publishedDate?: string;
  category?: string;
}

export type WebReadSearchResult = {
  operation: 'search';
  success: boolean;
  query: string;
  results: SearchResult[];
  total_results: number;
  estimated_total: number;
  has_more: boolean;
  next_start_index: number | null;
  suggestions?: string[];
  /**
   * Explicit instruction for the AI on what to do next.
   * This helps ensure the AI calls fetch_url after search.
   */
  next_action_required: string;
};

// =============================================================================
// SEARXNG API TYPES
// =============================================================================

export interface SearXNGResult {
  url: string;
  title: string;
  content?: string;
  engine?: string;
  engines?: string[];
  publishedDate?: string;
  category?: string;
}

export interface SearXNGResponse {
  query: string;
  results: SearXNGResult[];
  number_of_results?: number;
  suggestions?: string[];
}

export interface SearchOptions {
  query: string;
  numResults?: number;
  pageNo?: number;
  timeRange?: 'day' | 'week' | 'month' | 'year';
  categories?: string[];
  engines?: string[];
  safesearch?: 0 | 1 | 2;
  language?: string;
  site?: string;
}

// (URL helper functions moved to dedicated one-function files
//  get_crawler_service_url.ts and get_search_service_url.ts.)
