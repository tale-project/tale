/**
 * Website Pages action types
 */

export interface WebsitePagesActionParams {
  operation: 'bulk_upsert';
  organizationId?: string;
  websiteId?: string;
  pages?: Array<{
    url: string;
    title?: string;
    description?: string;
    content?: string;
    wordCount?: number;
    word_count?: number;
    metadata?: unknown;
    structuredData?: unknown;
    structured_data?: unknown;
  }>;
}

export interface WebsitePagesActionResult {
  operation: 'bulk_upsert';
  created: number;
  updated: number;
  total: number;
  success: boolean;
  timestamp: number;
}

