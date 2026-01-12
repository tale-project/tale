/**
 * Agent Context Manager
 *
 * High-level context management for agents (main chat and sub-agents).
 * Provides a unified API for:
 * - Building prioritized context
 * - Smart history filtering
 * - Proactive summarization triggers
 * - Context handler creation
 */

import type { ActionCtx } from '../../_generated/server';
import { ContextBuilder, type ContextBuildResult } from './context_builder';
import { createContextHandler, type ContextHandler, type ContextHandlerOptions } from './context_handler';
import {
  AGENT_CONTEXT_CONFIGS,
  SUMMARIZATION_THRESHOLD,
  DEFAULT_MODEL_CONTEXT_LIMIT,
  type AgentType,
} from './constants';
import { ContextPriority } from './context_priority';
import { createDebugLog } from '../debug_log';

const debugLog = createDebugLog('DEBUG_CONTEXT_MANAGEMENT', '[AgentContextManager]');

/**
 * Configuration for the agent context manager.
 */
export interface AgentContextManagerConfig {
  /** Agent type for default configurations */
  agentType: AgentType;
  /** Thread ID for this conversation */
  threadId: string;
  /** Override model context limit */
  modelContextLimit?: number;
  /** Enable summarization triggers */
  enableSummarization?: boolean;
  /** Summarization callback (called when summarization should be triggered) */
  onSummarizationNeeded?: (ctx: ActionCtx, threadId: string) => Promise<void>;
}

/**
 * Context setup result with all necessary components for agent execution.
 */
export interface ContextSetupResult {
  /** System messages to inject */
  systemMessages: Array<{ role: 'system'; content: string }>;
  /** Context handler for message ordering */
  contextHandler: ContextHandler;
  /** Whether summarization was triggered */
  summarizationTriggered: boolean;
  /** Context build result for debugging */
  buildResult: ContextBuildResult;
  /** Token usage estimate */
  tokenEstimate: {
    contextTokens: number;
    usagePercent: number;
  };
}

/**
 * Agent Context Manager
 *
 * Provides a complete context management solution for agents.
 *
 * Usage:
 * ```typescript
 * const manager = new AgentContextManager({
 *   agentType: 'web',
 *   threadId: 'thread_123',
 * });
 *
 * // Add context
 * manager
 *   .addSystemInfo()
 *   .addTaskContext('Search for React documentation')
 *   .addSummary(existingSummary);
 *
 * // Setup context for agent execution
 * const setup = await manager.setup(ctx, { currentPromptTokens: 100 });
 *
 * // Use in agent call
 * agent.streamText(ctx, { threadId }, {
 *   messages: setup.systemMessages,
 * }, {
 *   contextHandler: setup.contextHandler,
 * });
 * ```
 */
export class AgentContextManager {
  private config: AgentContextManagerConfig;
  private builder: ContextBuilder;

  constructor(config: AgentContextManagerConfig) {
    this.config = config;
    this.builder = new ContextBuilder({
      agentType: config.agentType,
      modelContextLimit: config.modelContextLimit,
    });
  }

  /**
   * Add system info (thread ID, timestamp).
   */
  addSystemInfo(): this {
    this.builder.addSystemInfo(this.config.threadId);
    return this;
  }

  /**
   * Add conversation summary.
   */
  addSummary(summary: string | undefined): this {
    if (summary) {
      this.builder.addSummary(summary);
    }
    return this;
  }

  /**
   * Add integrations info.
   */
  addIntegrations(integrationsInfo: string | undefined): this {
    if (integrationsInfo) {
      this.builder.addIntegrations(integrationsInfo);
    }
    return this;
  }

  /**
   * Add RAG results.
   */
  addRagResults(ragContext: string | undefined): this {
    if (ragContext) {
      this.builder.addRagResults(ragContext);
    }
    return this;
  }

  /**
   * Add task-specific context (commonly used by sub-agents).
   */
  addTaskContext(taskDescription: string): this {
    this.builder.addContext(
      'task_context',
      taskDescription,
      ContextPriority.HIGH_RELEVANCE,
      { sectionName: 'current_task' },
    );
    return this;
  }

  /**
   * Add custom context.
   */
  addContext(
    id: string,
    content: string,
    priority: ContextPriority,
    options?: {
      canTrim?: boolean;
      relevanceScore?: number;
      sectionName?: string;
    },
  ): this {
    this.builder.addContext(id, content, priority, options);
    return this;
  }

  /**
   * Add mandatory context that cannot be trimmed.
   */
  addMandatoryContext(id: string, content: string, sectionName?: string): this {
    this.builder.addMandatoryContext(id, content, sectionName);
    return this;
  }

  /**
   * Setup context for agent execution.
   * This builds the context, creates the handler, and optionally triggers summarization.
   */
  async setup(
    ctx: ActionCtx,
    options?: {
      currentPromptTokens?: number;
    },
  ): Promise<ContextSetupResult> {
    const agentConfig = AGENT_CONTEXT_CONFIGS[this.config.agentType];
    const modelContextLimit = this.config.modelContextLimit ?? agentConfig.modelContextLimit;
    const enableSummarization = this.config.enableSummarization ?? agentConfig.enableSummarization;

    // Build context with priority trimming
    const buildResult = this.builder.build();

    // Calculate usage
    const contextTokens = buildResult.totalTokens;
    const usagePercent = (contextTokens / modelContextLimit) * 100;

    // Check if summarization is needed
    let summarizationTriggered = false;
    if (enableSummarization && this.config.onSummarizationNeeded) {
      const usageRatio = contextTokens / modelContextLimit;
      if (usageRatio >= SUMMARIZATION_THRESHOLD) {
        debugLog('Triggering summarization', {
          threadId: this.config.threadId,
          usagePercent: usagePercent.toFixed(1) + '%',
          threshold: SUMMARIZATION_THRESHOLD * 100 + '%',
        });

        // Trigger async summarization (non-blocking)
        this.config.onSummarizationNeeded(ctx, this.config.threadId).catch((error) => {
          console.error('[AgentContextManager] Summarization failed:', error);
        });

        summarizationTriggered = true;
      }
    }

    // Create context handler with appropriate options
    const handlerOptions: ContextHandlerOptions = {
      modelContextLimit,
      outputReserve: agentConfig.outputReserve,
      minRecentMessages: Math.min(4, agentConfig.recentMessages),
    };
    const contextHandler = createContextHandler(handlerOptions);

    debugLog('Context setup complete', {
      agentType: this.config.agentType,
      threadId: this.config.threadId,
      contextTokens,
      usagePercent: usagePercent.toFixed(1) + '%',
      summarizationTriggered,
      wasTrimmed: buildResult.wasTrimmed,
    });

    return {
      systemMessages: buildResult.systemMessages,
      contextHandler,
      summarizationTriggered,
      buildResult,
      tokenEstimate: {
        contextTokens,
        usagePercent,
      },
    };
  }

  /**
   * Get the underlying builder for advanced usage.
   */
  getBuilder(): ContextBuilder {
    return this.builder;
  }

  /**
   * Reset the manager for reuse.
   */
  reset(): this {
    this.builder.reset();
    return this;
  }
}

/**
 * Create an agent context manager with configuration.
 */
export function createAgentContextManager(config: AgentContextManagerConfig): AgentContextManager {
  return new AgentContextManager(config);
}

/**
 * Quick setup for sub-agents that need minimal context management.
 *
 * This is a simplified API for sub-agents that don't need full context
 * management but still want proper message ordering and token estimation.
 */
export function createSubAgentContext(options: {
  agentType: AgentType;
  threadId: string;
  taskDescription: string;
  additionalContext?: Record<string, string>;
}): {
  systemMessages: Array<{ role: 'system'; content: string }>;
  contextHandler: ContextHandler;
} {
  const manager = new AgentContextManager({
    agentType: options.agentType,
    threadId: options.threadId,
    enableSummarization: false,
  });

  manager.addSystemInfo().addTaskContext(options.taskDescription);

  // Add any additional context
  if (options.additionalContext) {
    for (const [id, content] of Object.entries(options.additionalContext)) {
      manager.addContext(id, content, ContextPriority.MEDIUM_RELEVANCE);
    }
  }

  const buildResult = manager.getBuilder().build();
  const agentConfig = AGENT_CONTEXT_CONFIGS[options.agentType];

  return {
    systemMessages: buildResult.systemMessages,
    contextHandler: createContextHandler({
      modelContextLimit: agentConfig.modelContextLimit,
      outputReserve: agentConfig.outputReserve,
    }),
  };
}
