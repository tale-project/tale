/**
 * Constants for Context Management
 */

/**
 * Base token count for system instructions.
 * This should be updated if instructions change significantly.
 * After P1 optimization (moving detailed guidance to tool descriptions):
 * ~2,800 chars = ~700 tokens (reduced from ~17,500 chars / ~4,400 tokens)
 */
export const SYSTEM_INSTRUCTIONS_TOKENS = 800;

/**
 * Safety margin for context limit (75% of max).
 * Leaves room for output tokens and tool call overhead.
 */
export const CONTEXT_SAFETY_MARGIN = 0.75;

/**
 * Default model context limit in tokens.
 * Most modern models support 128K+, but we use a conservative default.
 */
export const DEFAULT_MODEL_CONTEXT_LIMIT = 128000;

/**
 * Number of recent messages to load by default.
 * This balances context quality with token efficiency.
 */
export const DEFAULT_RECENT_MESSAGES = 20;

/**
 * Reserve tokens for model output generation.
 * This ensures the model has room to generate a complete response.
 */
export const OUTPUT_RESERVE = 4096;

/**
 * Estimate for recent conversation history tokens.
 * Used for budget calculations when loading context.
 */
export const RECENT_MESSAGES_TOKEN_ESTIMATE = 10000;
