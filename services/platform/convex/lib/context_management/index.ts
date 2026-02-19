/**
 * Context Management Module
 *
 * Provides unified context management for all agents (main chat and sub-agents).
 * All agents are treated as equal and independent entry points.
 *
 * Key features:
 * 1. Token estimation with CJK awareness
 * 2. Priority-based context trimming
 * 3. Smart history filtering
 * 4. Collapsible HTML <details> structured context
 * 5. Full message history support
 * 6. Summarization support for long conversations
 *
 * Usage (same for all agents):
 * ```typescript
 * import { buildStructuredContext, AGENT_CONTEXT_CONFIGS } from './lib/context_management';
 *
 * const config = AGENT_CONTEXT_CONFIGS.workflow;
 * const structuredThreadContext = await buildStructuredContext({
 *   ctx,
 *   threadId,
 *   additionalContext: { key: 'value' },
 *   maxMessages: config.recentMessages,
 * });
 *
 * // Use system parameter for context, prompt for user request
 * const result = await agent.generateText(ctx, { threadId }, {
 *   system: structuredThreadContext.threadContext,  // History, RAG, integrations
 *   prompt: promptMessage,                    // User's current request
 * }, {
 *   contextOptions: {
 *     recentMessages: 0,  // Disable SDK history - we control it
 *     excludeToolMessages: false,
 *   },
 * });
 * ```
 */

// Constants
export {
  SYSTEM_INSTRUCTIONS_TOKENS,
  CONTEXT_SAFETY_MARGIN,
  DEFAULT_MODEL_CONTEXT_LIMIT,
  DEFAULT_RECENT_MESSAGES,
  OUTPUT_RESERVE,
  RECENT_MESSAGES_TOKEN_ESTIMATE,
  LARGE_MESSAGE_THRESHOLD,
  SUMMARIZATION_THRESHOLD,
  RECOVERY_TIMEOUT_MS,
  AGENT_CONTEXT_CONFIGS,
  type AgentType,
} from './constants';

// Token estimation
export {
  estimateTokens,
  estimateJsonTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
  estimateMessageDocTokens,
} from './estimate_tokens';

// Context priority
export {
  ContextPriority,
  createPrioritizedContext,
  trimContextsByPriority,
  prioritizedContextsToMessage,
  prioritizedContextsToMessages,
  type PrioritizedContext,
  type TrimResult,
} from './context_priority';

// Context builder
export {
  ContextBuilder,
  createContextBuilder,
  type ContextItem,
  type ContextBuildResult,
  type ContextBuilderOptions,
} from './context_builder';

// Structured context builder (for collapsible <details> formatted context)
export {
  buildStructuredContext,
  type BuildStructuredContextParams,
  type StructuredContextResult,
} from './structured_context_builder';

// Message formatters
export {
  wrapInDetails,
  formatUserMessage,
  formatAssistantMessage,
  formatToolCall,
  formatHumanInputRequest,
  formatHumanResponse,
  formatSystemInfo,
  formatContextSummary,
  formatKnowledgeBase,
  formatIntegrations,
  formatTaskDescription,
  formatAdditionalContext,
  formatParentThread,
  formatHistorySection,
  formatCurrentRequestSection,
  formatCurrentTurnSection,
  formatSystemMessage,
  formatCurrentTurn,
  type CurrentTurnToolCall,
} from './message_formatter';

// Context size estimation and proactive summarization
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

// Prioritized context building (used by routing agent)
export { buildPrioritizedContexts } from './build_prioritized_contexts';

// Thread summary loading
export { loadContextSummary } from './load_context_summary';
