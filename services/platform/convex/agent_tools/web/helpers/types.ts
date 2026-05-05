/**
 * Shared types and interfaces for web tool and its helpers
 */

// =============================================================================
// FETCH URL RESULT (web pages, documents, images)
// =============================================================================

export interface ServiceUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  model?: string;
}

export type WebFetchUrlResult = {
  operation: 'fetch_url';
  success: boolean;
  url: string;
  title?: string;
  content: string;
  word_count: number;
  page_count: number;
  vision_used: boolean;
  truncated?: boolean;
  error?: string;
  usage?: ServiceUsage;
};

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

export interface WebFetchExtractApiResponse {
  success: boolean;
  url: string;
  title?: string;
  content: string;
  content_type?: string;
  word_count: number;
  page_count: number;
  vision_used: boolean;
  error?: string;
  usage?: ServiceUsage;
}
