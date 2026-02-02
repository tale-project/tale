/**
 * Type definitions for Operator service API responses.
 */

export interface OperatorTokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cache_read_tokens?: number;
}

export interface OperatorChatResponse {
  success: boolean;
  message: string;
  response: string | null;
  error: string | null;
  duration_seconds: number | null;
  token_usage: OperatorTokenUsage | null;
  cost_usd: number | null;
  turns: number | null;
}
