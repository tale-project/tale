/**
 * Website Pages action types
 */

import type { Id } from '../../../../_generated/dataModel';

// Page data structure
// Note: We use camelCase consistently as per Convex conventions.
// The snake_case aliases (word_count, structured_data) are kept for
// backwards compatibility with existing workflows that may use them.
export interface PageData {
  url: string;
  title?: string;
  description?: string;
  content?: string;
  wordCount?: number;
  /** @deprecated Use wordCount instead */
  word_count?: number;
  metadata?: unknown;
  structuredData?: unknown;
  /** @deprecated Use structuredData instead */
  structured_data?: unknown;
}

// Discriminated union type for website pages operations
export type WebsitePagesActionParams = {
  operation: 'bulk_upsert';
  websiteId: Id<'websites'>;
  pages: PageData[];
};

export interface WebsitePagesActionResult {
  operation: 'bulk_upsert';
  created: number;
  updated: number;
  total: number;
  success: boolean;
  timestamp: number;
}

