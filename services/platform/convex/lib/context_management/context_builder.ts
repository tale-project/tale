/**
 * Context Builder
 *
 * High-level API for building agent context with prioritization.
 * This module provides a unified interface for both main chat agent
 * and sub-agents to build their system context.
 */

import { createDebugLog } from '../debug_log';
import {
  AGENT_CONTEXT_CONFIGS,
  SYSTEM_INSTRUCTIONS_TOKENS,
  RECENT_MESSAGES_TOKEN_ESTIMATE,
  type AgentType,
} from './constants';
import {
  ContextPriority,
  createPrioritizedContext,
  trimContextsByPriority,
  prioritizedContextsToMessages,
  type PrioritizedContext,
  type TrimResult,
} from './context_priority';
import { estimateTokens } from './estimate_tokens';

const debugLog = createDebugLog('DEBUG_CONTEXT_MANAGEMENT', '[ContextBuilder]');

/**
 * Context item that can be added to the builder.
 */
export interface ContextItem {
  /** Unique identifier */
  id: string;
  /** Content to include */
  content: string;
  /** Priority level */
  priority: ContextPriority;
  /** Whether this can be trimmed under budget pressure */
  canTrim?: boolean;
  /** Optional relevance score (0-1) for ranked content */
  relevanceScore?: number;
  /** Section name for XML output (defaults to id) */
  sectionName?: string;
}

/**
 * Result from building context.
 */
export interface ContextBuildResult {
  /** System messages to inject */
  systemMessages: Array<{ role: 'system'; content: string }>;
  /** All prioritized contexts (for debugging/analysis) */
  contexts: PrioritizedContext[];
  /** Trim result (shows what was kept/trimmed) */
  trimResult: TrimResult;
  /** Total token estimate */
  totalTokens: number;
  /** Whether any content was trimmed */
  wasTrimmed: boolean;
}

/**
 * Options for the context builder.
 */
export interface ContextBuilderOptions {
  /** Agent type for default configurations */
  agentType?: AgentType;
  /** Override model context limit */
  modelContextLimit?: number;
  /** Override output reserve */
  outputReserve?: number;
  /** Current prompt tokens (for budget calculation) */
  currentPromptTokens?: number;
}

/**
 * Context Builder class for building agent context.
 *
 * Usage:
 * ```typescript
 * const builder = new ContextBuilder({ agentType: 'web' });
 * builder
 *   .addContext('task_context', promptMessage, ContextPriority.HIGH_RELEVANCE)
 *   .addContext('history', summary, ContextPriority.CONVERSATION_SUMMARY);
 *
 * const result = builder.build();
 * ```
 */
export class ContextBuilder {
  private contexts: ContextItem[] = [];
  private options: ContextBuilderOptions;

  constructor(options?: ContextBuilderOptions) {
    this.options = options || {};
  }

  /**
   * Add a conversation summary.
   */
  addSummary(summary: string): this {
    if (!summary) return this;

    this.contexts.push({
      id: 'conversation_summary',
      content: summary,
      priority: ContextPriority.CONVERSATION_SUMMARY,
      canTrim: true,
      sectionName: 'conversation_summary',
    });
    return this;
  }

  /**
   * Add RAG/knowledge base results with automatic relevance splitting.
   */
  addRagResults(ragContext: string, highRelevanceThreshold = 0.7): this {
    if (!ragContext) return this;

    // Parse RAG results (format: [1] (Relevance: 85.0%)\ncontent\n\n---\n\n[2] ...)
    const resultPattern =
      /\[(\d+)\]\s*\(Relevance:\s*([\d.]+)%\)\n([\s\S]*?)(?=\n\n---\n\n|\n*$)/g;
    const highResults: string[] = [];
    const lowResults: string[] = [];

    let match;
    while ((match = resultPattern.exec(ragContext)) !== null) {
      const [fullMatch, , relevanceStr] = match;
      const relevance = parseFloat(relevanceStr) / 100;

      if (relevance >= highRelevanceThreshold) {
        highResults.push(fullMatch);
      } else {
        lowResults.push(fullMatch);
      }
    }

    if (highResults.length > 0) {
      this.contexts.push({
        id: 'rag_high',
        content: highResults.join('\n\n---\n\n'),
        priority: ContextPriority.HIGH_RELEVANCE,
        canTrim: true,
        relevanceScore: 0.8,
        sectionName: 'knowledge_base_primary',
      });
    }

    if (lowResults.length > 0) {
      this.contexts.push({
        id: 'rag_low',
        content: lowResults.join('\n\n---\n\n'),
        priority: ContextPriority.LOW_RELEVANCE,
        canTrim: true,
        relevanceScore: 0.5,
        sectionName: 'knowledge_base_secondary',
      });
    }

    return this;
  }

  /**
   * Add custom context with specified priority.
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
    if (!content) return this;

    this.contexts.push({
      id,
      content,
      priority,
      canTrim: options?.canTrim ?? true,
      relevanceScore: options?.relevanceScore,
      sectionName: options?.sectionName || id,
    });
    return this;
  }

  /**
   * Add a mandatory context that cannot be trimmed.
   */
  addMandatoryContext(id: string, content: string, sectionName?: string): this {
    if (!content) return this;

    this.contexts.push({
      id,
      content,
      priority: ContextPriority.SYSTEM_INFO,
      canTrim: false,
      sectionName: sectionName || id,
    });
    return this;
  }

  /**
   * Build the final context with priority-based trimming.
   */
  build(): ContextBuildResult {
    const agentType = this.options.agentType || 'chat';
    const config = AGENT_CONTEXT_CONFIGS[agentType];

    const modelContextLimit =
      this.options.modelContextLimit ?? config.modelContextLimit;
    const outputReserve = this.options.outputReserve ?? config.outputReserve;
    const currentPromptTokens = this.options.currentPromptTokens ?? 0;

    // Convert to prioritized contexts
    const prioritizedContexts: PrioritizedContext[] = this.contexts.map(
      (item) =>
        createPrioritizedContext(item.id, item.priority, item.content, {
          canTrim: item.canTrim,
          relevanceScore: item.relevanceScore,
          sectionName: item.sectionName,
        }),
    );

    // Calculate available token budget
    const contextBudget =
      modelContextLimit * 0.75 - // Safety margin
      SYSTEM_INSTRUCTIONS_TOKENS -
      RECENT_MESSAGES_TOKEN_ESTIMATE -
      currentPromptTokens -
      outputReserve;

    // Trim by priority
    const trimResult = trimContextsByPriority(
      prioritizedContexts,
      contextBudget,
    );

    // Convert to system messages
    const systemMessages = prioritizedContextsToMessages(trimResult.kept);

    debugLog('Context built', {
      agentType,
      totalContexts: this.contexts.length,
      keptContexts: trimResult.kept.length,
      trimmedContexts: trimResult.trimmed.length,
      totalTokens: trimResult.totalTokens,
      budget: contextBudget,
    });

    return {
      systemMessages,
      contexts: prioritizedContexts,
      trimResult,
      totalTokens: trimResult.totalTokens,
      wasTrimmed: trimResult.wasTrimmed,
    };
  }

  /**
   * Get token estimate without building.
   */
  estimateTokens(): number {
    return this.contexts.reduce(
      (sum, item) => sum + estimateTokens(item.content),
      0,
    );
  }

  /**
   * Reset the builder for reuse.
   */
  reset(): this {
    this.contexts = [];
    return this;
  }
}

/**
 * Create a context builder with default configuration for an agent type.
 */
export function createContextBuilder(agentType: AgentType): ContextBuilder {
  return new ContextBuilder({ agentType });
}
