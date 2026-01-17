/**
 * Context Management Module (Chat Agent)
 *
 * Re-exports from the shared context management module for backward compatibility.
 * New code should import directly from '../lib/context_management'.
 *
 * This module also includes chat-agent-specific functionality like:
 * - checkAndSummarizeIfNeeded (integrates with chat_agent.autoSummarizeIfNeeded)
 * - buildPrioritizedContexts (chat-agent-specific context building)
 */

// Re-export everything from the shared module
export {
  // Constants
  SYSTEM_INSTRUCTIONS_TOKENS,
  CONTEXT_SAFETY_MARGIN,
  DEFAULT_MODEL_CONTEXT_LIMIT,
  DEFAULT_RECENT_MESSAGES,
  OUTPUT_RESERVE,
  RECENT_MESSAGES_TOKEN_ESTIMATE,
  LARGE_MESSAGE_THRESHOLD,
  SUMMARIZATION_THRESHOLD,
  AGENT_CONTEXT_CONFIGS,
  type AgentType,
  // Token estimation
  estimateTokens,
  estimateJsonTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateMessageDocTokens,
  // Context priority
  ContextPriority,
  createPrioritizedContext,
  trimContextsByPriority,
  prioritizedContextsToMessage,
  prioritizedContextsToMessages,
  type PrioritizedContext,
  type TrimResult,
  // Context handler
  createContextHandler,
  type ContextHandler,
  type ContextHandlerArgs,
  type ContextHandlerOptions,
  // Context builder
  ContextBuilder,
  createContextBuilder,
  type ContextItem,
  type ContextBuildResult,
  type ContextBuilderOptions,
  // Agent context manager
  AgentContextManager,
  createAgentContextManager,
  createSubAgentContext,
  type AgentContextManagerConfig,
  type ContextSetupResult,
} from '../../lib/context_management';

// Chat-agent-specific exports
export {
  checkAndSummarizeIfNeeded,
  type CheckAndSummarizeArgs,
  type CheckAndSummarizeResult,
} from './check_and_summarize';

export {
  estimateContextSize,
  type ContextSizeEstimate,
  type EstimateContextSizeArgs,
} from './estimate_context_size';

// Chat-agent-specific context building helper
export { buildPrioritizedContexts } from './build_prioritized_contexts';
