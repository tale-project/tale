/**
 * Context Management Module
 *
 * Provides unified context management for all agents (main chat and sub-agents).
 *
 * Key features:
 * 1. Token estimation with CJK awareness
 * 2. Priority-based context trimming
 * 3. Smart history filtering
 * 4. Message reordering for optimal LLM understanding
 * 5. High-level context builder API
 *
 * Usage for main chat agent:
 * ```typescript
 * import { AgentContextManager } from './lib/context_management';
 *
 * const manager = new AgentContextManager({
 *   agentType: 'chat',
 *   threadId,
 *   enableSummarization: true,
 *   onSummarizationNeeded: async (ctx, tid) => {
 *     ctx.scheduler.runAfter(0, internal.chat_agent.actions.autoSummarizeIfNeeded, { threadId: tid });
 *   },
 * });
 *
 * manager
 *   .addSystemInfo()
 *   .addSummary(contextSummary)
 *   .addIntegrations(integrationsInfo)
 *   .addRagResults(ragContext);
 *
 * const setup = await manager.setup(ctx, { currentPromptTokens });
 * ```
 *
 * Usage for sub-agents:
 * ```typescript
 * import { createSubAgentContext } from './lib/context_management';
 *
 * const context = createSubAgentContext({
 *   agentType: 'web',
 *   threadId: subThreadId,
 *   taskDescription: 'Search for React 19 features',
 *   additionalContext: {
 *     search_query: 'React 19 new features',
 *   },
 * });
 *
 * const result = await agent.generateText(ctx, { threadId }, {
 *   messages: context.systemMessages,
 * }, {
 *   contextHandler: context.contextHandler,
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

// Context handler
export {
  createContextHandler,
  type ContextHandler,
  type ContextHandlerArgs,
  type ContextHandlerOptions,
} from './context_handler';

// Context builder
export {
  ContextBuilder,
  createContextBuilder,
  type ContextItem,
  type ContextBuildResult,
  type ContextBuilderOptions,
} from './context_builder';

// Agent context manager (high-level API)
export {
  AgentContextManager,
  createAgentContextManager,
  createSubAgentContext,
  type AgentContextManagerConfig,
  type ContextSetupResult,
} from './agent_context_manager';
