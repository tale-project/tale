/**
 * Type definitions and validators for website operations
 */

import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';

// =============================================================================
// VALIDATORS
// =============================================================================

/**
 * Website status validator
 */
export const websiteStatusValidator = v.union(
  v.literal('active'),
  v.literal('inactive'),
  v.literal('error'),
);

/**
 * Website document validator (matches schema)
 */
export const websiteValidator = v.object({
  _id: v.id('websites'),
  _creationTime: v.number(),
  organizationId: v.string(),
  domain: v.string(),
  title: v.optional(v.string()),
  description: v.optional(v.string()),
  scanInterval: v.string(),
  lastScannedAt: v.optional(v.number()),
  status: v.optional(websiteStatusValidator),
  metadata: v.optional(v.any()),
});

/**
 * Website page document validator (matches schema)
 */
export const websitePageValidator = v.object({
  _id: v.id('websitePages'),
  _creationTime: v.number(),
  organizationId: v.string(),
  websiteId: v.id('websites'),
  url: v.string(),
  title: v.optional(v.string()),
  content: v.optional(v.string()),
  wordCount: v.optional(v.number()),
  lastCrawledAt: v.number(),
  metadata: v.optional(v.record(v.string(), v.any())),
  structuredData: v.optional(v.record(v.string(), v.any())),
});

// =============================================================================
// TYPESCRIPT TYPES
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
    status?: 'active' | 'inactive' | 'error';
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
  status?: 'active' | 'inactive' | 'error';
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
