/**
 * Type definitions for website operations
 */

import type { Infer } from 'convex/values';

import type { Id } from '../_generated/dataModel';

import { websiteStatusValidator, websiteValidator } from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type WebsiteStatus = Infer<typeof websiteStatusValidator>;
export type Website = Infer<typeof websiteValidator>;

// =============================================================================
// MANUAL TYPES (no corresponding validator)
// =============================================================================

/**
 * Result from getting websites with pagination
 */
export interface GetWebsitesResult {
  page: Array<{
    _id: Id<'websites'>;
    _creationTime: number;
    organizationId: string;
    domain: string;
    title?: string;
    description?: string;
    scanInterval: string;
    lastScannedAt?: number;
    status?: WebsiteStatus;
    metadata?: unknown;
  }>;
  isDone: boolean;
  continueCursor?: string;
}

/**
 * Result from bulk creating websites
 */
export interface BulkCreateWebsitesResult {
  success: number;
  failed: number;
  errors: Array<{
    index: number;
    error: string;
    website: unknown;
  }>;
}

/**
 * Website data for bulk creation
 */
export interface BulkWebsiteData {
  domain: string;
  title?: string;
  description?: string;
  scanInterval: string;
  status?: WebsiteStatus;
  metadata?: Record<string, string | number | boolean | null>;
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
  title: string | null;
  description: string | null;
  page_count: number;
  status: WebsiteStatus;
  last_scanned_at: string | null;
}

export interface CrawlerPagesResponse {
  domain: string;
  pages: CrawlerPage[];
  total: number;
  offset: number;
  has_more: boolean;
}

export interface FetchPagesResult {
  pages: CrawlerPage[];
  total: number;
  offset: number;
  hasMore: boolean;
}
