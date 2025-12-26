/**
 * Context Management Module
 *
 * Handles context construction, ordering, and overflow management for the chat agent.
 *
 * Key responsibilities:
 * 1. Message ordering via contextHandler - ensures system context appears before history
 * 2. Token estimation for context budgeting
 * 3. Proactive context overflow detection and summarization
 * 4. Context priority management for token budget optimization
 */

// Constants
export {
  SYSTEM_INSTRUCTIONS_TOKENS,
  CONTEXT_SAFETY_MARGIN,
  DEFAULT_MODEL_CONTEXT_LIMIT,
  DEFAULT_RECENT_MESSAGES,
  OUTPUT_RESERVE,
  RECENT_MESSAGES_TOKEN_ESTIMATE,
} from './constants';

// Token estimation
export {
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateMessageDocTokens,
  estimateJsonTokens,
} from './estimate_tokens';

// Context handler for message ordering and smart history filtering
export {
  createContextHandler,
  type ContextHandler,
  type ContextHandlerArgs,
} from './context_handler';

// Context size estimation
export {
  estimateContextSize,
  type ContextSizeEstimate,
  type EstimateContextSizeArgs,
} from './estimate_context_size';

// Proactive summarization (async)
export {
  checkAndSummarizeIfNeeded,
  type CheckAndSummarizeArgs,
  type CheckAndSummarizeResult,
} from './check_and_summarize';

// Context priority management
export {
  buildPrioritizedContexts,
  trimContextsByPriority,
  prioritizedContextsToMessages,
  type PrioritizedContext,
  type TrimResult,
} from './context_priority';
