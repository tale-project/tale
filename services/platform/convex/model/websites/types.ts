/**
 * Type definitions for website operations
 */

import type { Infer } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import {
  websitePageValidator,
  websiteStatusValidator,
  websiteValidator,
} from './validators';

// =============================================================================
// INFERRED TYPES (from validators)
// =============================================================================

export type WebsiteStatus = Infer<typeof websiteStatusValidator>;
export type Website = Infer<typeof websiteValidator>;
export type WebsitePage = Infer<typeof websitePageValidator>;

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
  metadata?: unknown;
}

/**
 * Args for bulk upserting website pages
 */
export interface BulkUpsertPagesArgs {
  organizationId: string;
  websiteId: string;
  pages: Array<{
    url: string;
    title?: string;
    content?: string;
    wordCount?: number;
    metadata?: Record<string, unknown>;
    structuredData?: Record<string, unknown>;
  }>;
}

/**
 * Result from bulk upserting website pages
 */
export interface BulkUpsertPagesResult {
  created: number;
  updated: number;
  total: number;
}
