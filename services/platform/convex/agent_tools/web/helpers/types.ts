/**
 * Shared types and interfaces for web tool and its helpers
 */

// =============================================================================
// FETCH URL RESULT (via PDF pipeline)
// =============================================================================

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
};

// =============================================================================
// BROWSER OPERATE RESULT (via Operator service)
// =============================================================================

export type WebBrowserOperateResult = {
  operation: 'browser_operate';
  success: boolean;
  response: string;
  error?: string;
  sources?: string[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    durationSeconds?: number;
  };
};

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

export interface WebFetchExtractApiResponse {
  success: boolean;
  url: string;
  title?: string;
  content: string;
  word_count: number;
  page_count: number;
  vision_used: boolean;
  error?: string;
}

export interface OperatorChatResponse {
  success: boolean;
  response?: string;
  error?: string;
  sources?: string[];
  duration_seconds?: number;
  token_usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}
