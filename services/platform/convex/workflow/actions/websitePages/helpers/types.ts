/**
 * Website Pages action types
 */

import type { Id } from '../../../../_generated/dataModel';

// Page data structure
export interface PageData {
  url: string;
  title?: string;
  description?: string;
  content?: string;
  wordCount?: number;
  word_count?: number;
  metadata?: unknown;
  structuredData?: unknown;
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

